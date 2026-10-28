import struct
from importlib import import_module

from unicorn import UC_PROT_WRITE, UcError
import unicorn.x86_const as ux

from .arch import MODE64, encode_ptr, read_ptr
from .binary import encode_u32, encode_u64, read_u16, read_u32, read_u64, write_u32, write_u64


PAGE_SIZE = 0x1000
HOST_IMAGE_BASE = 0x00007FF900000000
EMU_HEAP_BASE = 0x0000020000000000
EMU_HEAP_SIZE = 0x1000000
TEB_BASE = 0x7FF700000000
PEB_BASE = 0x7FF710000000


def smbios_table():
    system = (struct.pack('<BBH', 1, 27, 0x100) + bytes((1, 2, 3, 4))
              + bytes.fromhex('00112233445566778899aabbccddeeff') + bytes((6, 5, 6))
              + b'Generic\0Desktop\0' + b'1.0\0' + b'00000000\0Standard\0Desktop\0\0')
    structures = system + struct.pack('<BBH', 127, 4, 0xFFFF) + b'\0\0'
    return struct.pack('<BBBBI', 0, 3, 2, 0, len(structures)) + structures


def normalize_module_name(name):
    normalized = name.replace("\\", "/").rsplit("/", 1)[-1].lower()
    if normalized and "." not in normalized:
        normalized += ".dll"
    return normalized


def split_import_label(label):
    dll, symbol = label.split("!", 1)
    return normalize_module_name(dll), symbol


class ApiHandlers:
    arch = MODE64
    wow64 = False

    def stack_slot(self, index):
        sp = self.uc.reg_read(self.arch.sp)
        if self.arch.bits == 64:
            return read_u64(self.uc.mem_read(sp + 8 + index * 8, 8))
        return read_u32(self.uc.mem_read(sp + 4 + index * 4, 4))

    def read_ptr_mem(self, address):
        return read_ptr(self.arch, self.uc.mem_read(address, self.arch.ptr))

    def memory_basic_information(self, address):
        page = address & -PAGE_SIZE
        if page >= 1 << 47:
            return None
        regions = list(self.uc.mem_regions())
        region = next((r for r in regions if r[0] <= page <= r[1]), None)
        if self.arch.bits == 32:
            api_handlers_32 = import_module('.32bit.api_handlers_32', __package__)
            return api_handlers_32.memory_basic_information(self, page, region, regions)
        if region is None:
            end = min((r[0] for r in regions if r[0] > page), default=1 << 47)
            info = bytearray(48)
            write_u64(info, 0, page)
            write_u64(info, 24, end - page)
            write_u32(info, 32, 0x10000)
            return bytes(info)
        start, end, permissions = region
        allocation = start
        protection = (1, 2, 4, 4, 0x10, 0x20, 0x40, 0x40)[permissions & 7]
        kind = 0x20000
        if EMU_HEAP_BASE <= page < EMU_HEAP_BASE + EMU_HEAP_SIZE:
            allocation, protection = EMU_HEAP_BASE, 4
        elif self.in_module(page):
            allocation, kind = self.image_start, 0x1000000
        elif start in self.module_bases.values() or start == HOST_IMAGE_BASE:
            kind = 0x1000000
        elif start in self.files.views:
            kind = 0x1000000 if self.files.views[start]["image"] else 0x40000
        info = bytearray(48)
        write_u64(info, 0, page)
        write_u64(info, 8, allocation)
        write_u32(info, 16, protection)
        write_u64(info, 24, end + 1 - page)
        write_u32(info, 32, 0x1000)
        write_u32(info, 36, protection)
        write_u32(info, 40, kind)
        return bytes(info)

    def writable_range(self, address, size):
        end = address + size
        for start, last, permissions in sorted(self.uc.mem_regions()):
            if start <= address <= last:
                if not permissions & UC_PROT_WRITE:
                    return False
                address = min(end, last + 1)
                if address == end:
                    return True
        return False

    def query_process_information(self, handle, information_class, output, length):
        information_class &= 0xFFFFFFFF
        length &= 0xFFFFFFFF
        details = dict(handle=handle, information_class=information_class,
                       output_address=hex(output), output_length=length)
        if self.arch.bits == 32:
            api_handlers_32 = import_module('.32bit.api_handlers_32', __package__)
            info = api_handlers_32.process_information_blob(self, information_class)
            if info is None:
                return None, details
        elif information_class == 0:
            info = struct.pack('<I4xQQi4xQQ', 0x103, PEB_BASE, self.process_affinity_mask, 8, 0x1337, 0)
        elif information_class == 21:
            info = encode_u64(self.process_affinity_mask)
        elif information_class in (7, 30, 31):
            info = int(information_class == 31).to_bytes(4 if information_class == 31 else 8, 'little')
        else:
            return None, details
        required = len(info)
        if length and output & 3:
            return 0x80000002, details
        try:
            returned = self.stack_slot(4)
        except UcError as exc:
            details['memory_error'] = str(exc)
            return 0xC0000005, details
        details['return_length_address'] = hex(returned)
        if returned and not self.writable_range(returned, 4):
            details['memory_error'] = 'return length buffer not writable'
            return 0xC0000005, details
        if length != required:
            return 0xC0000004, details
        if handle != self.arch.mask:
            if handle == self.arch.mask - 1 or handle in self.files.handles:
                return 0xC0000024, details
            return 0xC0000008, details
        if not self.writable_range(output, required):
            details['memory_error'] = 'process information buffer not writable'
            return 0xC0000005, details
        self.uc.mem_write(output, info)
        self.write_u32_if_mapped(returned, required)
        return (0xC0000353 if information_class == 30 else 0), details

    def set_process_affinity(self, mask):
        if not mask or mask & ~self.system_affinity_mask:
            return 0xC000000D
        self.process_affinity_mask = mask
        self.thread_affinity_mask &= mask
        if not self.thread_affinity_mask:
            self.thread_affinity_mask = mask
        return 0

    def set_thread_affinity(self, mask):
        if not mask or mask & ~self.process_affinity_mask:
            return 0xC000000D
        self.thread_affinity_mask = mask
        return 0

    def query_firmware_information(self, output, length, returned):
        length &= 0xFFFFFFFF
        details = dict(information_class=0x4C, output_length=length)
        if length < 16:
            return 0xC0000004, details
        try:
            provider, action, table, capacity = struct.unpack('<IIII', self.uc.mem_read(output, 16))
        except UcError:
            return 0xC0000005, details
        details.update(provider_signature=hex(provider), firmware_action=action,
                       table_id=hex(table), table_buffer_length=capacity)
        if provider == 0x4649524D and action == 0:
            data = b''
            result = 0xC0000002
            return_length = 0
        elif provider == 0x52534D42:
            if action == 0:
                data = encode_u32(0)
            elif action == 1 and table == 0:
                data = smbios_table()
            else:
                return None, details
            result = 0
            return_length = 16 + len(data)
        else:
            return None, details
        required = len(data)
        if result == 0 and length < 16 + required:
            result = 0xC0000023
        write_size = 16 + required if result == 0 else 16
        if not self.writable_range(output, write_size) or (returned and not self.writable_range(returned, 4)):
            return 0xC0000005, details
        self.uc.mem_write(output + 12, encode_u32(required))
        if result == 0:
            self.uc.mem_write(output + 16, data)
        self.write_u32_if_mapped(returned, return_length)
        return result, details

    def import_stack_bytes(self, label):
        if self.arch.bits == 64:
            return 0
        symbol = self.import_symbol(label)
        return 4 * self._handlers[symbol][1]

    @staticmethod
    def import_symbol(label):
        _, symbol = split_import_label(label)
        symbol = symbol.lower()
        return "nt" + symbol[2:] if symbol.startswith("zw") else symbol

    def emulate_import(self, label, *, argument_register=ux.UC_X86_REG_RCX):
        symbol = self.import_symbol(label)
        entry = self._handlers.get(symbol)
        if entry is None:
            pointer = self.uc.reg_read(ux.UC_X86_REG_RCX)
            if symbol in ("encodepointer", "decodepointer"):
                return pointer, {"fallback": symbol}
            if symbol in ("exitprocess", "terminateprocess"):
                code = pointer & 0xFFFFFFFF
                if code == 0xFFFFFFFF:
                    ignored = getattr(self, 'ignored_exits', 0)
                    if ignored < 3:
                        self.ignored_exits = ignored + 1
                        return 0, {"ignored_exit": code}
                return None, {"guest_hard_error": True, "exit_code": code}
            return 1, {"fallback": symbol}
        handler, argument_count = entry
        if self.arch.bits == 32 or argument_register is None:
            count = min(argument_count, 4)
            args = [self.stack_slot(index) for index in range(count)] + [0] * (4 - count)
        else:
            args = [self.uc.reg_read(register) for register in
                    (argument_register, ux.UC_X86_REG_RDX, ux.UC_X86_REG_R8, ux.UC_X86_REG_R9)]
        return handler(self, symbol, *args)

    def _nt_set_information_thread(self, symbol, rcx, rdx, r8, r9):
        information_class = rdx & 0xFFFFFFFF
        if information_class == 4:
            return self._nt_set_thread_affinity(symbol, rcx, rdx, r8, r9)
        if information_class == 17:
            return self._nt_hide_thread(symbol, rcx, rdx, r8, r9)
        return None, {}

    def _get_version(self, symbol, rcx, rdx, r8, r9):
        version = self.catalog.windows
        result = (version["build"] << 16) | (version["minor"] << 8) | version["major"]
        return result, {}

    def _get_version_info(self, symbol, rcx, rdx, r8, r9):
        version = self.catalog.windows
        size = read_u32(self.uc.mem_read(rcx, 4))
        wide = symbol != "getversionexa"
        basic, extended = (276, 284) if wide else (148, 156)
        if size not in (basic, extended):
            result = 0xC000000D if symbol == "rtlgetversion" else 0
        else:
            info = bytearray(size)
            struct.pack_into("<IIIII", info, 0, size, version["major"], version["minor"],
                             version["build"], version["platform_id"])
            if size == extended:
                struct.pack_into("<HHHBB", info, basic, version["service_pack_major"],
                                 version["service_pack_minor"], version["suite_mask"], version["product_type"], 0)
            self.uc.mem_write(rcx, bytes(info))
            result = 0 if symbol == "rtlgetversion" else 1
        return result, {}

    def _module_handle_a(self, symbol, rcx, rdx, r8, r9):
        details = {}
        if not rcx:
            return self.image_start, details
        requested = normalize_module_name(self.read_ascii(rcx))
        result = self.module_bases.get(requested, 0)
        details["requested_module"] = requested
        return result, details

    def _module_handle_w(self, symbol, rcx, rdx, r8, r9):
        details = {}
        if not rcx:
            return self.image_start, details
        requested = normalize_module_name(self.read_utf16(rcx))
        result = self.module_bases.get(requested, 0)
        details["requested_module"] = requested
        return result, details

    def _get_module_filename_w(self, symbol, rcx, rdx, r8, r9):
        details = {}
        path = self.module_paths.get(rcx)
        capacity = r8 & 0xFFFFFFFF
        if not capacity:
            result = 0
        elif path is None:
            self.last_error = 126
            result = 0
        else:
            encoded = path.encode("utf-16-le")
            length = len(encoded) // 2
            self.uc.mem_write(rdx, encoded[:(capacity - 1) * 2] + b"\0\0")
            result = length if length < capacity else capacity
            if length >= capacity:
                self.last_error = 122
            details["module_path"] = path
        return result, details

    def _get_proc_address(self, symbol, rcx, rdx, r8, r9):
        details = {}
        if rdx <= 0xFFFF:
            requested = rdx
        else:
            requested = self.read_ascii(rdx).lower()
        result = self.export_lookup.get((rcx, requested), 0)
        details["requested_export"] = requested
        return result, details

    def _get_process_heap(self, symbol, rcx, rdx, r8, r9):
        return self.arch.emu_heap_base, {}

    def _local_alloc(self, symbol, rcx, rdx, r8, r9):
        details = dict(allocation_size=rdx, allocation_flags=rcx & 0xFFFFFFFF)
        if rcx & 0xFFFFFFFF & ~0xF70:
            return None, details
        try:
            result = self.heap_allocate(rdx)
        except MemoryError:
            self.last_error = 8
            result = 0
        if result:
            self.local_allocations.add(result)
        return result, details

    def _local_free(self, symbol, rcx, rdx, r8, r9):
        if not rcx:
            result = 0
        elif rcx in self.local_allocations:
            self.local_allocations.remove(rcx)
            self.heap_allocations.pop(rcx)
            result = 0
        else:
            self.last_error = 6
            result = rcx
        return result, {}

    def _heap_alloc(self, symbol, rcx, rdx, r8, r9):
        details = {}
        result = self.heap_allocate(r8)
        details["allocation_size"] = r8
        return result, details

    def _heap_realloc(self, symbol, rcx, rdx, r8, r9):
        details = {}
        old, size = r8, r9
        result = self.heap_allocate(size)
        old_size = self.heap_allocations.get(old, 0)
        if old and old_size and result:
            count = min(old_size, size)
            try:
                self.uc.mem_write(result, bytes(self.uc.mem_read(old, count)))
            except UcError:
                pass
        details["allocation_size"] = size
        return result, details

    def _heap_size(self, symbol, rcx, rdx, r8, r9):
        result = self.heap_allocations.get(r8, self.arch.mask)
        return result, {}

    def _return_success(self, symbol, rcx, rdx, r8, r9):
        return 1, {}

    def _virtual_alloc(self, symbol, rcx, rdx, r8, r9):
        details = {}
        result = self.heap_allocate(rdx)
        details["allocation_size"] = rdx
        return result, details

    def _virtual_protect(self, symbol, rcx, rdx, r8, r9):
        self.write_u32_if_mapped(r9, 0x40)
        return 1, {}

    def _nt_protect_virtual_memory(self, symbol, rcx, rdx, r8, r9):
        details = {}
        try:
            old_protection = self.stack_slot(4)
            self.write_u32_if_mapped(old_protection, 0x40)
        except UcError:
            pass
        return 0, details

    def _copy_virtual_memory(self, symbol, rcx, rdx, r8, r9):
        size = r9 & 0xFFFFFFFF
        details = {'wrote': size, 'destination': hex(rdx)}
        if size > 0x100000:
            return 0xC000000D, details
        try:
            if 'read' in symbol:
                data = bytes(self.uc.mem_read(rdx, size))
                self.uc.mem_write(r8, data)
            else:
                data = bytes(self.uc.mem_read(r8, size))
                self.uc.mem_write(rdx, data)
        except UcError:
            return 0xC0000005, details
        try:
            self.write_ptr_if_mapped(self.stack_slot(4), size)
        except UcError:
            pass
        return (0 if symbol.startswith('nt') else 1), details

    def _nt_set_information_process(self, symbol, rcx, rdx, r8, r9):
        details = dict(handle=rcx, information_class=rdx & 0xFFFFFFFF,
                       input_address=r8, input_length=r9 & 0xFFFFFFFF)
        if (rdx & 0xFFFFFFFF) == 21:
            if (r9 & 0xFFFFFFFF) != self.arch.ptr:
                return 0xC0000004, details
            if rcx != self.arch.mask:
                return 0xC0000008, details
            try:
                mask = self.read_ptr_mem(r8)
            except UcError:
                return 0xC0000005, details
            details['affinity_mask'] = hex(mask)
            return self.set_process_affinity(mask), details
        if rcx != self.arch.mask or (rdx & 0xFFFFFFFF) != 0x28 or (r9 & 0xFFFFFFFF) != 16:
            return None, details
        try:
            if bytes(self.uc.mem_read(r8, 16)) != bytes(16):
                return None, details
        except UcError:
            return None, details
        return 0, details

    def _nt_query_information_process(self, symbol, rcx, rdx, r8, r9):
        return self.query_process_information(rcx, rdx, r8, r9)

    def _nt_query_virtual_memory(self, symbol, rcx, rdx, r8, r9):
        details = dict(memory_address=rdx, information_class=r8 & 0xFFFFFFFF)
        if r8 & 0xFFFFFFFF:
            return None, details
        length = self.stack_slot(4)
        returned = self.stack_slot(5)
        if rcx != self.arch.mask:
            result = 0xC0000008
        elif length < (48 if self.arch.bits == 64 else 28):
            result = 0xC0000004
        else:
            info = self.memory_basic_information(rdx)
            if info is None:
                result = 0xC000000D
            else:
                self.uc.mem_write(r9, info)
                self.write_ptr_if_mapped(returned, len(info))
                result = 0
        return result, details

    def _nt_set_thread_affinity(self, symbol, rcx, rdx, r8, r9):
        details = dict(handle=rcx, information_class=4, input_address=r8, input_length=r9 & 0xFFFFFFFF)
        if (r9 & 0xFFFFFFFF) != self.arch.ptr:
            return 0xC0000004, details
        if rcx != self.arch.mask - 1:
            return 0xC0000008, details
        try:
            mask = self.read_ptr_mem(r8)
        except UcError:
            return 0xC0000005, details
        details['affinity_mask'] = hex(mask)
        return self.set_thread_affinity(mask), details

    def _nt_hide_thread(self, symbol, rcx, rdx, r8, r9):
        details = dict(handle=rcx, information_class=17, input_address=r8, input_length=r9)
        if (r9 & 0xFFFFFFFF) != 0:
            result = 0xC0000004
        elif rcx != self.arch.mask - 1:
            result = 0xC0000008
        else:
            self.thread_hidden_from_debugger = True
            result = 0
        return result, details

    def _close_handle(self, symbol, rcx, rdx, r8, r9):
        status, details = self._nt_close(symbol, rcx, rdx, r8, r9)
        if status:
            self.last_error = 6
        return int(status == 0), details

    def _nt_close(self, symbol, rcx, rdx, r8, r9):
        details = dict(handle=rcx, known_handle=rcx in self.files.handles)
        if details['known_handle']:
            del self.files.handles[rcx]
            result = 0
        else:
            result = 3221225480
        return result, details

    def _nt_create_debug_object(self, symbol, rcx, rdx, r8, r9):
        flags = r9 & 0xFFFFFFFF
        details = dict(output_address=rcx, desired_access=rdx & 0xFFFFFFFF,
                       object_attributes=r8, flags=flags)
        if not self.writable_range(rcx, self.arch.ptr):
            return 0xC0000005, details
        if flags & ~1:
            return 0xC000000D, details
        if r8:
            size = 48 if self.arch.bits == 64 else 24
            if r8 & (self.arch.ptr - 1):
                return 0x80000002, details
            try:
                attributes = bytes(self.uc.mem_read(r8, size))
            except UcError:
                return 0xC0000005, details
            if read_u32(attributes) != size:
                return 0xC000000D, details
            if any(attributes[8 if self.arch.bits == 64 else 4:]):
                return None, details
        handle = self.files.handle({'kind': 'debug_object'})
        self.write_ptr_if_mapped(rcx, handle)
        details['handle'] = handle
        return 0, details

    def _nt_query_object(self, symbol, rcx, rdx, r8, r9):
        information_class = rdx & 0xFFFFFFFF
        length = r9 & 0xFFFFFFFF
        details = dict(handle=rcx, information_class=information_class,
                       output_address=r8, output_length=length)
        if information_class != 2:
            return None, details
        if length and r8 & (self.arch.ptr - 1):
            return 0x80000002, details
        try:
            returned = self.stack_slot(4)
        except UcError:
            return 0xC0000005, details
        details['return_length_address'] = returned
        if (length and not self.writable_range(r8, length)) or (returned and not self.writable_range(returned, 4)):
            return 0xC0000005, details
        record = self.files.handles.get(rcx)
        if record is None:
            return 0xC0000008, details
        if record['kind'] != 'debug_object':
            return None, details
        header_size = 104 if self.arch.bits == 64 else 96
        name = 'DebugObject'.encode('utf-16-le') + b'\0\0'
        required = header_size + len(name)
        if length < required:
            self.write_u32_if_mapped(returned, required)
            return 0xC0000004, details
        info = bytearray(required)
        struct.pack_into('<HH', info, 0, len(name) - 2, len(name))
        info[self.arch.ptr:self.arch.ptr * 2] = encode_ptr(self.arch, r8 + header_size)
        count = sum(item['kind'] == 'debug_object' for item in self.files.handles.values())
        struct.pack_into('<II', info, self.arch.ptr * 2, count, count)
        info[header_size:] = name
        self.uc.mem_write(r8, bytes(info))
        self.write_u32_if_mapped(returned, required)
        return 0, details


    def _return_zero(self, symbol, rcx, rdx, r8, r9):
        return 0, {}

    def _nt_open_file(self, symbol, rcx, rdx, r8, r9):
        details = {}
        if r8:
            object_name = self.read_ptr_mem(r8 + (16 if self.arch.bits == 64 else 8))
            if object_name:
                length = read_u16(self.uc.mem_read(object_name, 2))
                buffer = self.read_ptr_mem(object_name + (8 if self.arch.bits == 64 else 4))
                details["requested_file"] = bytes(self.uc.mem_read(buffer, min(length, 4096))).decode("utf-16-le", errors="replace")
        handle = self.files.open(details.get("requested_file", ""))
        result = 0 if handle is not None else 0xC0000034
        if handle is not None:
            self.write_ptr_if_mapped(rcx, handle)
        if r9:
            self.uc.mem_write(r9, struct.pack("<QQ" if self.arch.bits == 64 else "<II", result, 0))
        return result, details

    def _nt_raise_hard_error(self, symbol, rcx, rdx, r8, r9):
        details = {}
        details["guest_hard_error"] = True
        details["status"] = rcx
        details["unicode_parameters"] = []
        for index in range(min(rdx, 8)):
            if r8 & (1 << index):
                descriptor = self.read_ptr_mem(r9 + index * self.arch.ptr)
                length = read_u16(self.uc.mem_read(descriptor, 2))
                buffer = self.read_ptr_mem(descriptor + (8 if self.arch.bits == 64 else 4))
                details["unicode_parameters"].append(bytes(self.uc.mem_read(buffer, min(length, 16384))).decode("utf-16-le", errors="replace"))
        if (rcx & 0xFFFFFFFF) == 0x50000018:
            details["guest_hard_error"] = False
            return 0, details
        return None, details

    def _nt_create_section(self, symbol, rcx, rdx, r8, r9):
        details = {}
        attributes = read_u32(self.uc.mem_read(self.uc.reg_read(self.arch.sp) + (0x30 if self.arch.bits == 64 else 0x18), 4))
        file_handle = self.stack_slot(6)
        handle = self.files.section(file_handle, attributes)
        result = 0 if handle is not None else 0xC0000008
        if handle is not None:
            self.write_ptr_if_mapped(rcx, handle)
        details["section_attributes"] = attributes
        return result, details

    def _nt_map_view_of_section(self, symbol, rcx, rdx, r8, r9):
        details = {}
        if self.read_ptr_mem(r8):
            raise ValueError("fixed address file views not supported")
        offset_pointer = self.stack_slot(5)
        size_pointer = self.stack_slot(6)
        view, view_size = self.files.map(rcx, self.read_ptr_mem(offset_pointer) if offset_pointer else 0,
                                         self.read_ptr_mem(size_pointer) if size_pointer else 0)
        self.write_ptr_if_mapped(r8, view)
        self.write_ptr_if_mapped(size_pointer, view_size)
        details.update(self.files.views[view])
        if self.diagnostics:
            self.diagnostics.watch_mapping(self.uc, view, view_size, self.files.views[view]['name'])
        return 0, details

    def _nt_open_section(self, symbol, rcx, rdx, r8, r9):
        details = {}
        try:
            name = self.read_ptr_mem(r8 + self.arch.ptr * 2)
            length = read_u16(self.uc.mem_read(name, 2))
            buffer = self.read_ptr_mem(name + self.arch.ptr)
            requested = bytes(self.uc.mem_read(buffer, length)).decode('utf-16-le')
        except UcError:
            return 0xC0000005, details
        details['requested_section'] = requested
        if requested.lower() != r'\knowndlls\ntdll.dll':
            return 0xC0000022, details
        if not self.writable_range(rcx, self.arch.ptr):
            return 0xC0000005, details
        handle = self.files.image_section('ntdll.dll')
        if handle is None:
            return 0xC0000034, details
        self.uc.mem_write(rcx, encode_ptr(self.arch, handle))
        return 0, details

    def _nt_query_information_thread(self, symbol, rcx, rdx, r8, r9):
        information_class = rdx & 0xFFFFFFFF
        details = dict(handle=rcx, information_class=information_class,
                       output_address=r8, output_length=r9)

        try:
            return_length = self.stack_slot(4)
            details["return_length_address"] = return_length
        except UcError as exc:
            details["return_length_address_error"] = str(exc)
            return 0xC0000005, details
        result = 0
        if self.arch.bits == 32:
            api_handlers_32 = import_module('.32bit.api_handlers_32', __package__)
            info = api_handlers_32.thread_information_blob(self, information_class)
            if info is None:
                return None, details
        elif information_class == 0:
            info = struct.pack('<I4xQQQQii', 0x103, TEB_BASE, 0x1337, 0x7331,
                               self.thread_affinity_mask, 8, 8)
        elif information_class == 17:
            info = bytes([self.thread_hidden_from_debugger])
        else:
            return None, details
        if (r9 & 0xFFFFFFFF) != len(info):
            result = 0xC0000004
        elif rcx != self.arch.mask - 1:
            result = 0xC0000008
        elif not self.writable_range(r8, len(info)) or (return_length and not self.writable_range(return_length, 4)):
            result = 0xC0000005
        else:
            self.uc.mem_write(r8, info)
            self.write_u32_if_mapped(return_length, len(info))
        return result, details

    def _nt_query_system_information(self, symbol, rcx, rdx, r8, r9):
        details = {}
        information_class = rcx & 0xFFFFFFFF
        details.update(information_class=information_class, output_length=r8 & 0xFFFFFFFF)
        if information_class == 0x4C:
            return self.query_firmware_information(rdx, r8, r9)
        elif information_class == 0:
            if self.arch.bits == 32:
                api_handlers_32 = import_module('.32bit.api_handlers_32', __package__)
                info = api_handlers_32.system_basic_information(self)
            else:
                info = struct.pack('<7I4xQQQB7x', 0, 156250, PAGE_SIZE, 0x200000,
                                   1, 0x200000, 0x10000, 0x10000, 0x7FFFFFFEFFFF,
                                   self.system_affinity_mask, self.system_affinity_mask.bit_count())
        elif information_class == 0x23:
            info = b"\x00\x01"
        elif information_class == 0x0B:
            info = bytes(8)
        else:
            return None, details
        if r9 and not self.writable_range(r9, 4):
            result = 0xC0000005
        else:
            self.write_u32_if_mapped(r9, len(info))
            if ((r8 & 0xFFFFFFFF) != len(info) if information_class == 0
                    else (r8 & 0xFFFFFFFF) < len(info)):
                result = 0xC0000004
            elif not self.writable_range(rdx, len(info)):
                result = 0xC0000005
            else:
                self.uc.mem_write(rdx, info)
                result = 0
        return result, details

    def _get_current_process(self, symbol, rcx, rdx, r8, r9):
        return self.arch.mask, {}



    def _is_wow64_process(self, symbol, rcx, rdx, r8, r9):
        if rcx != self.arch.mask:
            self.last_error = 6
            return 0, {}
        if not self.writable_range(rdx, 4):
            self.last_error = 998
            return 0, {}
        self.write_u32_if_mapped(rdx, int(self.wow64))
        return 1, {}

    def _get_process_affinity_mask(self, symbol, rcx, rdx, r8, r9):
        if rcx != self.arch.mask:
            self.last_error = 6
            result = 0
        elif not rdx or not r8:
            self.last_error = 87
            result = 0
        else:
            self.write_ptr_if_mapped(rdx, self.process_affinity_mask)
            self.write_ptr_if_mapped(r8, self.system_affinity_mask)
            result = 1
        return result, {}

    def _get_current_thread(self, symbol, rcx, rdx, r8, r9):
        return self.arch.mask - 1, {}

    def _set_affinity_mask(self, symbol, rcx, rdx, r8, r9):
        handle = self.arch.mask if symbol == "setprocessaffinitymask" else self.arch.mask - 1
        if rcx != handle:
            self.last_error = 6
            result = 0
        elif symbol == "setprocessaffinitymask":
            result = int(self.set_process_affinity(rdx) == 0)
            if not result:
                self.last_error = 87
        else:
            previous = self.thread_affinity_mask
            if self.set_thread_affinity(rdx):
                self.last_error = 87
                result = 0
            else:
                result = previous
        return result, {}

    def _get_current_process_id(self, symbol, rcx, rdx, r8, r9):
        return 0x1337, {}

    def _get_current_thread_id(self, symbol, rcx, rdx, r8, r9):
        return 0x7331, {}

    def _query_performance_counter(self, symbol, rcx, rdx, r8, r9):
        self.write_u64_if_mapped(rcx, self.blocks)
        return 1, {}

    def _heap_create(self, symbol, rcx, rdx, r8, r9):
        return self.arch.emu_heap_base, {"allocation_size": r8}

    def _get_tick_count64(self, symbol, rcx, rdx, r8, r9):
        return self.blocks & 0xFFFFFFFF, {}

    def _sleep(self, symbol, rcx, rdx, r8, r9):
        details = {}
        details["milliseconds"] = rcx & 0xFFFFFFFF
        return 0, details

    def _get_system_time_as_file_time(self, symbol, rcx, rdx, r8, r9):
        self.write_u64_if_mapped(rcx, 0x01D9000000000000)
        return 0, {}

    def _set_last_error(self, symbol, rcx, rdx, r8, r9):
        self.last_error = rcx & 0xFFFFFFFF
        return 0, {}

    def _get_last_error(self, symbol, rcx, rdx, r8, r9):
        result = self.last_error
        return result, {}

    def _store_bytes(self, data):
        address = self.heap_allocate(len(data))
        self.uc.mem_write(address, data)
        return address

    def _ensure_process_strings(self):
        if getattr(self, 'command_line_a', None):
            return
        path = self.module_paths.get(self.image_start, r'C:\vmp-probe.vmp.exe')
        line = '"%s" check %s' % (path, 'A' * 128)
        narrow = line.encode('ascii') + b'\x00'
        wide = line.encode('utf-16-le') + b'\x00\x00'
        self.command_line_a = self._store_bytes(narrow)
        self.command_line_w = self._store_bytes(wide)
        env = b'PATH=C:\\Windows\\System32\x00SystemRoot=C:\\Windows\x00\x00'
        self.environment_a = self._store_bytes(env)
        self.environment_w = self._store_bytes(env.decode('ascii').encode('utf-16-le') + b'\x00\x00')
        params = self.heap_allocate(0x100)
        self.uc.mem_write(params + 0x70, struct.pack('<HH4xQ', len(wide) - 2, len(wide), self.command_line_w))
        image = path.encode('utf-16-le') + b'\x00\x00'
        image_buf = self._store_bytes(image)
        self.uc.mem_write(params + 0x60, struct.pack('<HH4xQ', len(image) - 2, len(image), image_buf))
        self.uc.mem_write(PEB_BASE + 0x20, encode_u64(params))

    def _get_command_line(self, symbol, rcx, rdx, r8, r9):
        self._ensure_process_strings()
        if symbol.endswith('w'):
            return self.command_line_w, {}
        return self.command_line_a, {}

    def _get_environment_strings(self, symbol, rcx, rdx, r8, r9):
        self._ensure_process_strings()
        if symbol.endswith('w'):
            return self.environment_w, {}
        return self.environment_a, {}

    def _fls_table(self):
        table = getattr(self, 'fls_slots', None)
        if table is None:
            self.fls_slots = {}
            self.fls_next = 1
        return self.fls_slots

    def _fls_alloc(self, symbol, rcx, rdx, r8, r9):
        table = self._fls_table()
        index = self.fls_next
        self.fls_next = index + 1
        table[index] = 0
        return index, {}

    def _fls_set_value(self, symbol, rcx, rdx, r8, r9):
        table = self._fls_table()
        index = rcx & 0xFFFFFFFF
        if index not in table:
            self.last_error = 87
            return 0, {}
        table[index] = rdx
        return 1, {}

    def _fls_get_value(self, symbol, rcx, rdx, r8, r9):
        table = self._fls_table()
        index = rcx & 0xFFFFFFFF
        if index not in table:
            self.last_error = 87
            return 0, {}
        self.last_error = 0
        return table[index], {}

    def _code_page(self, symbol, rcx, rdx, r8, r9):
        return 1252, {}

    def _is_valid_code_page(self, symbol, rcx, rdx, r8, r9):
        return 1, {}

    def _get_cp_info(self, symbol, rcx, rdx, r8, r9):
        page = rcx & 0xFFFFFFFF
        if not rdx:
            self.last_error = 87
            return 0, {}
        info = bytearray(18)
        max_char = 4 if page == 65001 else 1
        struct.pack_into('<I', info, 0, max_char)
        info[4] = 0x3F
        try:
            self.uc.mem_write(rdx, bytes(info))
        except UcError:
            self.last_error = 998
            return 0, {}
        return 1, {}

    def _get_startup_info(self, symbol, rcx, rdx, r8, r9):
        if not rcx:
            return 0, {}
        info = bytearray(104)
        struct.pack_into('<I', info, 0, 104)
        struct.pack_into('<Q', info, 80, 0x10)
        struct.pack_into('<Q', info, 88, 0x11)
        struct.pack_into('<Q', info, 96, 0x12)
        self.uc.mem_write(rcx, bytes(info))
        return 0, {}

    def _get_std_handle(self, symbol, rcx, rdx, r8, r9):
        handles = {0xFFFFFFF6: 0x10, 0xFFFFFFF5: 0x11, 0xFFFFFFF4: 0x12}
        result = handles.get(rcx & 0xFFFFFFFF, 0)
        if not result:
            self.last_error = 6
        return result, {}

    def _get_file_type(self, symbol, rcx, rdx, r8, r9):
        if (rcx & 0xFFFFFFFFFFFFFFFF) in (0x10, 0x11, 0x12):
            return 2, {}
        self.last_error = 6
        return 0, {}

    def _get_console_mode(self, symbol, rcx, rdx, r8, r9):
        if not rdx or (rcx & 0xFFFFFFFFFFFFFFFF) not in (0x10, 0x11, 0x12):
            self.last_error = 6
            return 0, {}
        self.write_u32_if_mapped(rdx, 0x3)
        return 1, {}

    def _console_cp(self, symbol, rcx, rdx, r8, r9):
        if symbol.startswith('set'):
            return 1, {}
        return 65001, {}

    def _locale_id(self, symbol, rcx, rdx, r8, r9):
        return 0x409, {}

    def _read_narrow(self, address, size):
        if size == 0xFFFFFFFF:
            return self.read_ascii(address).encode('ascii', 'replace') + b'\x00'
        return bytes(self.uc.mem_read(address, size))

    def _read_wide(self, address, chars):
        if chars in (0, 0xFFFFFFFF):
            return self.read_utf16(address).encode('utf-16-le') + b'\x00\x00'
        return bytes(self.uc.mem_read(address, chars * 2))

    def _multibyte_to_wide(self, symbol, rcx, rdx, r8, r9):
        dest = self.stack_slot(4)
        dest_cch = self.stack_slot(5) & 0xFFFFFFFF
        raw = self._read_narrow(r8, r9 & 0xFFFFFFFF)
        wide = raw.decode('utf-8' if (rcx & 0xFFFFFFFF) == 65001 else 'cp1252', 'replace').encode('utf-16-le')
        chars = len(wide) // 2
        if dest_cch == 0:
            return chars, {}
        count = min(chars, dest_cch)
        if dest:
            self.uc.mem_write(dest, wide[:count * 2])
        return count, {}

    def _wide_to_multibyte(self, symbol, rcx, rdx, r8, r9):
        dest = self.stack_slot(4)
        dest_cb = self.stack_slot(5) & 0xFFFFFFFF
        raw = self._read_wide(r8, r9 & 0xFFFFFFFF)
        text = raw.decode('utf-16-le', 'replace')
        encoded = text.encode('utf-8' if (rcx & 0xFFFFFFFF) == 65001 else 'cp1252', 'replace')
        if dest_cb == 0:
            return len(encoded), {}
        count = min(len(encoded), dest_cb)
        if dest:
            self.uc.mem_write(dest, encoded[:count])
        return count, {}

    def _get_string_type_w(self, symbol, rcx, rdx, r8, r9):
        count = r8 & 0xFFFFFFFF
        raw = self._read_wide(rdx, count)
        chars = len(raw) // 2
        if not r9 or chars > 0x10000:
            self.last_error = 87
            return 0, {}
        out = bytearray(chars * 2)
        for index in range(chars):
            ch = raw[index * 2] | (raw[index * 2 + 1] << 8)
            if 65 <= ch <= 90:
                flags = 0x0001 | 0x0100 | 0x0200
            elif 97 <= ch <= 122:
                flags = 0x0002 | 0x0100 | 0x0200
            elif 48 <= ch <= 57:
                flags = 0x0004 | 0x0080 | 0x0200
            elif ch in (32, 9):
                flags = 0x0008 | 0x0040 | 0x0200
            else:
                flags = 0x0200
            struct.pack_into('<H', out, index * 2, flags)
        self.uc.mem_write(r9, bytes(out))
        return 1, {}

    def _lcmap_string_w(self, symbol, rcx, rdx, r8, r9):
        dest = self.stack_slot(4)
        dest_cch = self.stack_slot(5) & 0xFFFFFFFF
        raw = self._read_wide(r8, r9 & 0xFFFFFFFF)
        if rdx & 0x400:
            if dest_cch == 0:
                return len(raw), {}
            count = min(len(raw), dest_cch)
            if dest:
                self.uc.mem_write(dest, raw[:count])
            return count, {}
        chars = len(raw) // 2
        if dest_cch == 0:
            return chars, {}
        count = min(chars, dest_cch)
        if dest:
            self.uc.mem_write(dest, raw[:count * 2])
        return count, {}

    def _compare_string_w(self, symbol, rcx, rdx, r8, r9):
        other = self.stack_slot(4)
        other_cch = self.stack_slot(5) & 0xFFFFFFFF
        left = self._read_wide(r8, r9 & 0xFFFFFFFF).decode('utf-16-le', 'replace').rstrip('\x00')
        right = self._read_wide(other, other_cch).decode('utf-16-le', 'replace').rstrip('\x00')
        result = 2 if left == right else (1 if left < right else 3)
        details = {}
        if len(left) >= 32 or len(right) >= 32:
            details = {'left': left[:200], 'right': right[:200]}
        return result, details

    def _get_locale_info_a(self, symbol, rcx, rdx, r8, r9):
        text = b'0409\x00'
        capacity = r9 & 0xFFFFFFFF
        if capacity == 0:
            return len(text), {}
        if not r8:
            self.last_error = 87
            return 0, {}
        count = min(len(text), capacity)
        self.uc.mem_write(r8, text[:count])
        return count, {}

    def _initialize_slist(self, symbol, rcx, rdx, r8, r9):
        if rcx:
            self.uc.mem_write(rcx, b'\x00' * 16)
        return 0, {}

    def _get_system_info(self, symbol, rcx, rdx, r8, r9):
        if not rcx:
            return 0, {}
        info = bytearray(48)
        struct.pack_into('<HH', info, 0, 9, 0)
        struct.pack_into('<I', info, 4, 0x1000)
        struct.pack_into('<QQ', info, 8, 0x10000, 0x7FFFFFFEFFFF)
        struct.pack_into('<QII', info, 24, self.system_affinity_mask, 8, 8664)
        struct.pack_into('<IHH', info, 40, 0x10000, 6, 0)
        self.uc.mem_write(rcx, bytes(info))
        return 0, {}

    def _processor_feature(self, symbol, rcx, rdx, r8, r9):
        return 1, {}

    def _module_filename_a(self, symbol, rcx, rdx, r8, r9):
        path = self.module_paths.get(rcx if rcx else self.image_start)
        capacity = r8 & 0xFFFFFFFF
        if not path or not capacity:
            self.last_error = 126 if path is None else 122
            return 0, {}
        encoded = path.encode('ascii', 'replace')
        count = min(len(encoded), capacity - 1)
        self.uc.mem_write(rdx, encoded[:count] + b'\x00')
        if len(encoded) >= capacity:
            self.last_error = 122
            return capacity, {}
        return len(encoded), {'module_path': path}

    def _module_handle_ex_w(self, symbol, rcx, rdx, r8, r9):
        if not r8:
            self.last_error = 87
            return 0, {}
        base = self.image_start
        if rcx & 4:
            for name, start in self.module_bases.items():
                if start <= rdx < start + self.arch.emu_module_size:
                    base = start
                    break
            if self.image_start <= rdx < self.image_end:
                base = self.image_start
        elif rdx:
            requested = normalize_module_name(self.read_utf16(rdx))
            base = self.module_bases.get(requested, 0)
        if not base:
            self.last_error = 126
            return 0, {}
        self.write_ptr_if_mapped(r8, base)
        return 1, {}

    def _write_console(self, symbol, rcx, rdx, r8, r9):
        count = r8 & 0xFFFFFFFF
        data = b''
        if rdx and count and count < 0x100000:
            data = bytes(self.uc.mem_read(rdx, count * (2 if symbol.endswith('w') else 1)))
        chunks = getattr(self, 'console_output', None)
        if chunks is None:
            self.console_output = []
            chunks = self.console_output
        chunks.append(data)
        if r9:
            self.write_u32_if_mapped(r9, count)
        return 1, {'wrote': count}

    def _set_environment(self, symbol, rcx, rdx, r8, r9):
        return 1, {}

    def _get_string_type_a(self, symbol, rcx, rdx, r8, r9):
        dest = self.stack_slot(4)
        count = r9 & 0xFFFFFFFF
        raw = self._read_narrow(r8, count)
        if count != 0xFFFFFFFF:
            raw = raw[:count]
        if not dest or len(raw) > 0x10000:
            self.last_error = 87
            return 0, {}
        out = bytearray(len(raw) * 2)
        for index, ch in enumerate(raw):
            if 65 <= ch <= 90:
                flags = 0x0001 | 0x0100 | 0x0200
            elif 97 <= ch <= 122:
                flags = 0x0002 | 0x0100 | 0x0200
            elif 48 <= ch <= 57:
                flags = 0x0004 | 0x0080 | 0x0200
            elif ch in (32, 9):
                flags = 0x0008 | 0x0040 | 0x0200
            else:
                flags = 0x0200
            struct.pack_into('<H', out, index * 2, flags)
        self.uc.mem_write(dest, bytes(out))
        return 1, {}

    def _lcmap_string_a(self, symbol, rcx, rdx, r8, r9):
        dest = self.stack_slot(4)
        dest_cch = self.stack_slot(5) & 0xFFFFFFFF
        raw = self._read_narrow(r8, r9 & 0xFFFFFFFF)
        if (r9 & 0xFFFFFFFF) != 0xFFFFFFFF:
            raw = raw[:r9 & 0xFFFFFFFF]
        if dest_cch == 0:
            return len(raw), {}
        count = min(len(raw), dest_cch)
        if dest:
            self.uc.mem_write(dest, raw[:count])
        return count, {}

    def _filetime_to_system(self, symbol, rcx, rdx, r8, r9):
        if not rdx:
            return 0, {}
        self.uc.mem_write(rdx, struct.pack('<8H', 2024, 1, 1, 1, 0, 0, 0, 0))
        return 1, {}

    def _systemtime_to_filetime(self, symbol, rcx, rdx, r8, r9):
        if not rdx:
            return 0, {}
        self.write_u64_if_mapped(rdx, 0x01D9000000000000)
        return 1, {}

    def _raise_exception(self, symbol, rcx, rdx, r8, r9):
        return None, {'guest_hard_error': True, 'exit_code': rcx & 0xFFFFFFFF}

    def _toolhelp_fail(self, symbol, rcx, rdx, r8, r9):
        self.last_error = 18
        return 0, {}

    _handlers = {
        'getversion': (_get_version, 0),
        'rtlgetversion': (_get_version_info, 1),
        'getversionexa': (_get_version_info, 1),
        'getversionexw': (_get_version_info, 1),
        'getmodulehandlea': (_module_handle_a, 1),
        'loadlibrarya': (_module_handle_a, 1),
        'loadlibraryexa': (_module_handle_a, 3),
        'getmodulehandlew': (_module_handle_w, 1),
        'loadlibraryw': (_module_handle_w, 1),
        'loadlibraryexw': (_module_handle_w, 3),
        'getmodulefilenamew': (_get_module_filename_w, 3),
        'getprocaddress': (_get_proc_address, 2),
        'getprocessheap': (_get_process_heap, 0),
        'heapcreate': (_heap_create, 3),
        'localalloc': (_local_alloc, 2),
        'localfree': (_local_free, 1),
        'heapalloc': (_heap_alloc, 3),
        'heaprealloc': (_heap_realloc, 4),
        'heapsize': (_heap_size, 3),
        'heapfree': (_return_success, 3),
        'virtualfree': (_return_success, 3),
        'freelibrary': (_return_success, 1),
        'closehandle': (_close_handle, 1),
        'virtualalloc': (_virtual_alloc, 4),
        'virtualprotect': (_virtual_protect, 4),
        'ntprotectvirtualmemory': (_nt_protect_virtual_memory, 5),
        'ntwritevirtualmemory': (_copy_virtual_memory, 5),
        'ntreadvirtualmemory': (_copy_virtual_memory, 5),
        'writeprocessmemory': (_copy_virtual_memory, 5),
        'readprocessmemory': (_copy_virtual_memory, 5),
        'ntsetinformationprocess': (_nt_set_information_process, 4),
        'ntqueryinformationprocess': (_nt_query_information_process, 5),
        'ntqueryvirtualmemory': (_nt_query_virtual_memory, 6),
        'ntsetinformationthread': (_nt_set_information_thread, 4),
        'ntclose': (_nt_close, 1),
        'ntcreatedebugobject': (_nt_create_debug_object, 4),
        'ntqueryobject': (_nt_query_object, 5),
        'ntdelayexecution': (_return_zero, 2),
        'ntopenfile': (_nt_open_file, 6),
        'ntraiseharderror': (_nt_raise_hard_error, 6),
        'ntcreatesection': (_nt_create_section, 7),
        'ntmapviewofsection': (_nt_map_view_of_section, 10),
        'ntunmapviewofsection': (_return_zero, 2),
        'ntopensection': (_nt_open_section, 3),
        'ntqueryinformationthread': (_nt_query_information_thread, 5),
        'ntquerysysteminformation': (_nt_query_system_information, 4),
        'getcurrentprocess': (_get_current_process, 0),
        'iswow64process': (_is_wow64_process, 2),
        'getprocessaffinitymask': (_get_process_affinity_mask, 3),
        'getcurrentthread': (_get_current_thread, 0),
        'setprocessaffinitymask': (_set_affinity_mask, 2),
        'setthreadaffinitymask': (_set_affinity_mask, 2),
        'getcurrentprocessid': (_get_current_process_id, 0),
        'getcurrentthreadid': (_get_current_thread_id, 0),
        'disablethreadlibrarycalls': (_return_success, 1),
        'freeenvironmentstringsw': (_return_success, 1),
        'freeenvironmentstringsa': (_return_success, 1),
        'getcommandlinea': (_get_command_line, 0),
        'getcommandlinew': (_get_command_line, 0),
        'getenvironmentstrings': (_get_environment_strings, 0),
        'getenvironmentstringsw': (_get_environment_strings, 0),
        'setenvironmentvariablew': (_set_environment, 2),
        'flsalloc': (_fls_alloc, 1),
        'flssetvalue': (_fls_set_value, 2),
        'flsgetvalue': (_fls_get_value, 1),
        'flsfree': (_return_success, 1),
        'getacp': (_code_page, 0),
        'getoemcp': (_code_page, 0),
        'isvalidcodepage': (_is_valid_code_page, 1),
        'getcpinfo': (_get_cp_info, 2),
        'getstartupinfoa': (_get_startup_info, 1),
        'getstartupinfow': (_get_startup_info, 1),
        'getstdhandle': (_get_std_handle, 1),
        'setstdhandle': (_return_success, 2),
        'getfiletype': (_get_file_type, 1),
        'getconsolemode': (_get_console_mode, 2),
        'getconsolecp': (_console_cp, 0),
        'getconsoleoutputcp': (_console_cp, 0),
        'setconsolecp': (_console_cp, 1),
        'setconsoleoutputcp': (_console_cp, 1),
        'getuserdefaultlcid': (_locale_id, 0),
        'getsystemdefaultlcid': (_locale_id, 0),
        'getthreadlocale': (_locale_id, 0),
        'multibytetowidechar': (_multibyte_to_wide, 6),
        'widechartomultibyte': (_wide_to_multibyte, 8),
        'getstringtypew': (_get_string_type_w, 4),
        'getstringtypea': (_get_string_type_a, 5),
        'lcmapstringw': (_lcmap_string_w, 6),
        'lcmapstringa': (_lcmap_string_a, 6),
        'filetimetosystemtime': (_filetime_to_system, 2),
        'systemtimetofiletime': (_systemtime_to_filetime, 2),
        'raiseexception': (_raise_exception, 4),
        'createtoolhelp32snapshot': (_toolhelp_fail, 2),
        'thread32first': (_toolhelp_fail, 2),
        'thread32next': (_toolhelp_fail, 2),
        'comparestringw': (_compare_string_w, 6),
        'getlocaleinfoa': (_get_locale_info_a, 4),
        'initializeslisthead': (_initialize_slist, 1),
        'getsysteminfo': (_get_system_info, 1),
        'isprocessorfeaturepresent': (_processor_feature, 1),
        'getmodulefilenamea': (_module_filename_a, 3),
        'getmodulehandleexw': (_module_handle_ex_w, 3),
        'heapsetinformation': (_return_success, 4),
        'writefile': (_write_console, 5),
        'writeconsolea': (_write_console, 5),
        'writeconsolew': (_write_console, 5),
        'setunhandledexceptionfilter': (_return_zero, 1),
        'unhandledexceptionfilter': (_return_zero, 1),
        'sethandlecount': (_return_success, 1),
        'queryperformancecounter': (_query_performance_counter, 1),
        'gettickcount': (_get_tick_count64, 0),
        'gettickcount64': (_get_tick_count64, 0),
        'sleep': (_sleep, 1),
        'getsystemtimeasfiletime': (_get_system_time_as_file_time, 1),
        'deletecriticalsection': (_return_success, 1),
        'entercriticalsection': (_return_success, 1),
        'leavecriticalsection': (_return_success, 1),
        'initializecriticalsection': (_return_success, 1),
        'initializecriticalsectionandspincount': (_return_success, 2),
        'initializecriticalsectionex': (_return_success, 3),
        'releasesrwlockexclusive': (_return_success, 1),
        'acquiresrwlockexclusive': (_return_success, 1),
        'setlasterror': (_set_last_error, 1),
        'getlasterror': (_get_last_error, 0),
        'isdebuggerpresent': (_return_zero, 0),
    }
