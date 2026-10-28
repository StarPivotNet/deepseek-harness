"""Driver for the vendored VMProtect engine.

unpack/ and catalog/ sit next to this file. Run artifacts go to --work
(default: vmp3104-work under the current working directory, never inside
the agi-reverse skill directory).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SKILL = Path(__file__).resolve().parent
ROOT = SKILL.parent.parent
if str(SKILL) not in sys.path:
    sys.path.insert(0, str(SKILL))

CATALOG = SKILL / "catalog"
CATALOG_FILES = ("catalog.json", "ntdll.dll", "catalog_32.json", "ntdll_32.dll")


def inside_skill(path: Path) -> bool:
    resolved = path.resolve()
    return resolved == ROOT or ROOT in resolved.parents


def require_work(path: Path) -> Path:
    resolved = path.resolve()
    if inside_skill(resolved):
        raise SystemExit("refusing --work inside the skill; pass --work outside it")
    resolved.mkdir(parents=True, exist_ok=True)
    return resolved


def default_work() -> Path:
    cwd = Path.cwd().resolve()
    if inside_skill(cwd):
        raise SystemExit("refusing default --work inside the skill; pass --work outside it")
    return cwd / "vmp3104-work"


def newest_trace(work: Path) -> Path | None:
    traces = [item for item in work.glob("trace_*") if item.is_dir()]
    if not traces:
        return None
    return max(traces, key=lambda item: item.stat().st_mtime)


def cmd_doctor() -> int:
    failed = False
    for name in ("pefile", "capstone", "unicorn"):
        try:
            __import__(name)
        except Exception as exc:
            print(f"{name} missing {exc}")
            failed = True
        else:
            print(f"{name} ok")
    for name in CATALOG_FILES:
        path = CATALOG / name
        if path.is_file():
            print(f"{name} ok {path.stat().st_size}")
        else:
            print(f"{name} missing")
            failed = True
    if failed:
        return 1
    import unpack.tracer  # noqa: F401
    print("engine ok")
    return 0


def load_pe(path: Path):
    from unpack.pe import parse_pe

    return parse_pe(path.read_bytes()), path.read_bytes()


def section_name(section) -> str:
    return section.Name.rstrip(b"\0").decode("ascii", "replace")


def cmd_identify(pe_path: Path) -> int:
    pe, _data = load_pe(pe_path)
    bits = 64 if pe.OPTIONAL_HEADER.Magic == 0x20B else 32
    entry = pe.OPTIONAL_HEADER.AddressOfEntryPoint
    entry_section = ""
    packed = []
    text_raw = None
    for section in pe.sections:
        name = section_name(section)
        if name == ".text":
            text_raw = section.SizeOfRawData
        if section.Misc_VirtualSize and not section.SizeOfRawData:
            packed.append(name)
        start = section.VirtualAddress
        end = start + max(section.Misc_VirtualSize, section.SizeOfRawData)
        if start <= entry < end:
            entry_section = name
    text_empty = text_raw == 0
    entry_outside_text = entry_section != ".text"
    shape = "packed" if packed and (text_empty or entry_outside_text) else "image"
    print(f"shape {shape}")
    print(f"bits {bits}")
    print(f"entry_rva 0x{entry:X}")
    print(f"entry_section {entry_section or 'none'}")
    print("packed_sections " + (",".join(packed) if packed else "none"))
    return 0


def cmd_keys(pe_path: Path) -> int:
    from unpack.discover import recover_keys

    found = recover_keys(pe_path.read_bytes())
    if not found:
        print("no key")
        return 0
    for key, offsets in found.items():
        places = ",".join(f"0x{offset:X}" for offset in offsets)
        print(f"key 0x{key:08X} offsets {places}")
    return 0


def cmd_imports(pe_path: Path, output: Path, arch32: bool) -> int:
    from unpack.arch import MODE32, MODE64
    from unpack.static_imports import run_static_imports

    output.parent.mkdir(parents=True, exist_ok=True)
    if inside_skill(output):
        raise SystemExit("refusing output inside the skill")
    run_static_imports(pe_path, output, MODE32 if arch32 else MODE64)
    print(output)
    return 0


def cmd_emulate(pe_path: Path, work: Path, arch32: bool, output_name: str | None) -> int:
    from unpack.arch import MODE32, MODE64
    from unpack.progress import watch_run
    from unpack.tracer import final_output_path, run

    work = require_work(work)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    trace = work / f"trace_{stamp}"
    trace.mkdir()
    arch = MODE32 if arch32 else MODE64
    final_path = final_output_path(pe_path.resolve(), output_name, work)
    if inside_skill(final_path):
        raise SystemExit("refusing output inside the skill")
    with watch_run(trace) as progress:
        run(pe_path.resolve(), final_path, trace, progress, None, arch)
    print(trace)
    return 0


def cmd_crc(pe_path: Path) -> int:
    from unpack.loader_crc import discover_crc_loops

    pe, _data = load_pe(pe_path)
    found = discover_crc_loops(pe)
    if not found:
        print("no crc")
        return 1
    for address in sorted(found):
        print(f"0x{address:X}")
    return 0


def cmd_lzma(pe_path: Path) -> int:
    from unpack.semantic_lzma import discover_lzma_candidates

    pe, _data = load_pe(pe_path)
    found = discover_lzma_candidates(pe)
    if not found:
        print("no lzma")
        return 1
    for row in found:
        print(f"0x{row['address']:X}")
    return 0


def cmd_unwind(pe_path: Path, output: Path) -> int:
    from unpack.unwind import repair_exception_tables

    if inside_skill(output):
        raise SystemExit("refusing output inside the skill")
    output.parent.mkdir(parents=True, exist_ok=True)
    repaired, report = repair_exception_tables(bytearray(pe_path.read_bytes()))
    output.write_bytes(repaired)
    print(f"pdata_status {report.get('pdata_status')}")
    print(output)
    return 0


def cmd_summary(work: Path) -> int:
    if inside_skill(work):
        raise SystemExit("refusing --work inside the skill; pass --work outside it")
    if not work.is_dir():
        print("no trace")
        return 1
    trace = newest_trace(work)
    if trace is None:
        print("no trace")
        return 1
    print(trace)
    summary = trace / "summary.json"
    if not summary.is_file():
        print("kind absent")
        return 0
    data = json.loads(summary.read_text(encoding="utf-8"))
    print("kind " + str(data.get("kind", data.get("entry_kind", "absent"))))
    if "entry" in data:
        print("entry " + str(data["entry"]))
    return 0


def cmd_capture(work: Path) -> int:
    if inside_skill(work):
        raise SystemExit("refusing --work inside the skill; pass --work outside it")
    if not work.is_dir():
        print("no trace")
        return 1
    trace = newest_trace(work)
    if trace is None:
        print("no trace")
        return 1
    capture = trace / "capture.txt"
    if not capture.is_file():
        print("no capture.txt")
        return 1
    print(f"{capture} {capture.stat().st_size}")
    return 0


def cmd_verify(pe_path: Path, args: list[str], work: Path, from_capture: bool) -> int:
    if inside_skill(work):
        raise SystemExit("refusing --work inside the skill; pass --work outside it")
    command = [str(pe_path), *args]
    if from_capture:
        trace = newest_trace(work)
        capture = None if trace is None else trace / "capture.txt"
        if capture is None or not capture.is_file():
            print("no capture.txt")
            return 1
        print(capture)
    completed = subprocess.run(command, check=False)
    print(f"exit {completed.returncode}")
    return 0


def cmd_self_check() -> int:
    status = cmd_doctor()
    if status != 0:
        return status
    from unpack.discover import recover_keys

    if recover_keys(b"") != {}:
        print("recover_keys empty input failed")
        return 1
    print("engine import ok")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="vmp3104")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("doctor")
    sub.add_parser("self-check")

    identify = sub.add_parser("identify")
    identify.add_argument("pe", type=Path)

    keys = sub.add_parser("keys")
    keys.add_argument("pe", type=Path)

    imports = sub.add_parser("imports")
    imports.add_argument("pe", type=Path)
    imports.add_argument("output", type=Path)
    imports.add_argument("--32bit", dest="arch32", action="store_true")

    emulate = sub.add_parser("emulate")
    emulate.add_argument("pe", type=Path)
    emulate.add_argument("output_name", nargs="?")
    emulate.add_argument("--32bit", dest="arch32", action="store_true")
    emulate.add_argument("--work", type=Path, default=None)

    crc = sub.add_parser("crc")
    crc.add_argument("pe", type=Path)

    lzma = sub.add_parser("lzma")
    lzma.add_argument("pe", type=Path)

    unwind = sub.add_parser("unwind")
    unwind.add_argument("pe", type=Path)
    unwind.add_argument("output", type=Path)

    summary = sub.add_parser("summary")
    summary.add_argument("--work", type=Path, default=None)

    capture = sub.add_parser("capture")
    capture.add_argument("--work", type=Path, default=None)

    verify = sub.add_parser("verify")
    verify.add_argument("pe", type=Path)
    verify.add_argument("args", nargs="*")
    verify.add_argument("--work", type=Path, default=None)
    verify.add_argument("--from-capture", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "doctor":
            return cmd_doctor()
        if args.command == "self-check":
            return cmd_self_check()
        if args.command == "identify":
            return cmd_identify(args.pe)
        if args.command == "keys":
            return cmd_keys(args.pe)
        if args.command == "imports":
            return cmd_imports(args.pe, args.output, args.arch32)
        if args.command == "emulate":
            work = args.work if args.work is not None else default_work()
            return cmd_emulate(args.pe, work, args.arch32, args.output_name)
        if args.command == "crc":
            return cmd_crc(args.pe)
        if args.command == "lzma":
            return cmd_lzma(args.pe)
        if args.command == "unwind":
            return cmd_unwind(args.pe, args.output)
        if args.command == "summary":
            work = args.work if args.work is not None else default_work()
            return cmd_summary(work)
        if args.command == "capture":
            work = args.work if args.work is not None else default_work()
            return cmd_capture(work)
        if args.command == "verify":
            work = args.work if args.work is not None else default_work()
            return cmd_verify(args.pe, args.args, work, args.from_capture)
    except (OSError, ValueError) as exc:
        print(exc)
        return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
