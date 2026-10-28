"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _sharedUtils = require("./shared-utils");
var _crypto = _interopRequireDefault(require("crypto"));
var _fsExtra = _interopRequireDefault(require("fs"));
var _jsrsasign = _interopRequireDefault(require("jsrsasign"));
var _jszip = _interopRequireDefault(require("jszip"));
var _path = _interopRequireDefault(require("path"));
var _CompileMode = _interopRequireDefault(require("./CompileMode"));
var _ZipUtil = _interopRequireDefault(require("./ZipUtil"));
var _Base = _interopRequireDefault(require("./Base64"));
var _CRC = _interopRequireDefault(require("./CRC32"));
var _Signer = _interopRequireDefault(require("./Signer"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * SignUtil
 */
class SignUtil {
  /**
   * Load signing-related config
   * @param param IJavascriptCompileOption — signing directory and related fields
   * @returns
   */
  static async getProjectSignConfig(param) {
    const {
      mode,
      projectPath,
      signRoot,
      signRequest
    } = param;
    if (signRequest) {
      return signRequest();
    }
    const signPathFolder = _path.default.join(projectPath, signRoot || 'sign');
    const signPathConfig = {
      debug: {
        privatekey: _path.default.join(signPathFolder, 'debug', 'private.pem'),
        certificate: _path.default.join(signPathFolder, 'debug', 'certificate.pem')
      },
      sign: {
        privatekey: _path.default.join(signPathFolder, 'private.pem'),
        certificate: _path.default.join(signPathFolder, 'certificate.pem')
      },
      defaultDevelopment: {
        privatekey: _path.default.join(__dirname, 'pem', 'private.pem'),
        certificate: _path.default.join(__dirname, 'pem', 'certificate.pem')
      },
      oldRelease: {
        privatekey: _path.default.join(signPathFolder, 'release', 'private.pem'),
        certificate: _path.default.join(signPathFolder, 'release', 'certificate.pem')
      }
    };
    // build mode: prefer sign/debug certs, then sign/ certs, then toolkit defaults
    const developmentSignConfig = [signPathConfig.debug, signPathConfig.sign, signPathConfig.defaultDevelopment];
    // release mode: prefer sign/release certs, then sign/ certs
    const releaseSignConfig = [signPathConfig.oldRelease, signPathConfig.sign];
    let modeSignConfig = [];
    switch (mode) {
      case _CompileMode.default.DEVELOPMENT:
        modeSignConfig = developmentSignConfig;
        break;
      case _CompileMode.default.PRODUCTION:
        modeSignConfig = releaseSignConfig;
        break;
      default:
        // log that the mode is undefined
        _sharedUtils.ColorConsole.error(`Error: mode ${mode} undefined`);
        break;
    }
    // find a valid certificate path
    const findPath = modeSignConfig.find(_ref => {
      let {
        privatekey,
        certificate
      } = _ref;
      return _sharedUtils.FileUtil.checkFilePath([privatekey, certificate]);
    });
    if (findPath) {
      let {
        privatekey: privatekeyPath,
        certificate: certificatePath
      } = findPath;
      _sharedUtils.ColorConsole.info('privatekeyPath is ', {
        word: privatekeyPath
      }, `\ncertificatePath is `, {
        word: certificatePath
      });
      // read certificate contents
      return {
        privatekey: _fsExtra.default.readFileSync(privatekeyPath),
        certificate: _fsExtra.default.readFileSync(certificatePath)
      };
    } else {
      // throw: no certificate found for the given mode
      throw new Error(`The current mode is ${mode}, and there is a problem with the certification path`);
    }
  }

  /**
   * Sign a binary zipBuffer
   *
   * 1. Sign `META-INF/CERT` and produce a new `META-INF/CERT` buffer
   * 2. Build a new zipBuffer from the new `META-INF/CERT` plus other files
   * 3. Sign the new zipBuffer as a whole
   * @param zipBuffer
   * @param privatekey
   * @param certificate
   * @returns
   */
  static async signPackage(target, privatekey, certificate) {
    const getFileBuffer = path => {
      return target.getResource(path);
    };

    // digests and file list
    const fileDigestHash = [];
    const fileList = [];

    // 1
    const metaBuffer = getFileBuffer(_ZipUtil.default.CERT_PATH)?.fileContentBuffer;
    if (metaBuffer) {
      const metaHash = {
        name: _ZipUtil.default.DIGEST_HASH_JSON,
        hash: _sharedUtils.CommonUtil.calcDataDigest(metaBuffer)
      };
      const signedMetaBuffer = SignUtil.doSign(metaBuffer, [metaHash], privatekey, certificate);
      if (signedMetaBuffer === false) {
        // META-INF/CERT signature failed
        _sharedUtils.ColorConsole.throw('META-INF/CERT signature failed');
      } else {
        fileList.push({
          path: _ZipUtil.default.CERT_PATH,
          content: signedMetaBuffer
        });
        fileDigestHash.push({
          name: _ZipUtil.default.CERT_PATH,
          hash: _sharedUtils.CommonUtil.calcDataDigest(signedMetaBuffer)
        });
      }
    }
    // 2
    const files = target.resourceList;
    files.map(item => {
      return {
        path: item.fileBuildPath,
        content: item.fileContentBuffer
      };
    }).filter(SignUtil.fileFilter).map(item => {
      fileList.push(item);
      fileDigestHash.push({
        name: item.path,
        hash: _sharedUtils.CommonUtil.calcDataDigest(item.content)
      });
    });
    // recreate the ZIP stream because META changed
    const newZipBuffer = await _ZipUtil.default.createZipBufferFromFileList(fileList, target.comment);
    // 3
    const signedZipBuffer = SignUtil.doSign(newZipBuffer, fileDigestHash, privatekey, certificate);
    if (signedZipBuffer === false) {
      // signature failed
      _sharedUtils.ColorConsole.throw('package signature failed');
    }
    return signedZipBuffer;
  }
  /**
   * Build file instances from a ZIP stream
   *
   * 1. Convert zipBuffer to a JSZip object
   * 2. Extract the file list and a buffer for each file
   * 3. Create a function that returns a file buffer
   *
   * @param zipBuffer
   * @returns
   */
  static async createFileListFromZipBuffer(zipBuffer) {
    const zipInst = await _jszip.default.loadAsync(zipBuffer, _ZipUtil.default.ZIP_OPTION);
    async function iterator(filePath) {
      const content = await zipInst.files[filePath].async('nodebuffer');
      return {
        path: filePath,
        content
      };
    }
    const fileList = await Promise.all(Object.keys(zipInst.files).map(iterator));
    return {
      fileList,
      comment: zipInst.comment,
      getFileBuffer(path) {
        const buffer = fileList.find(item => item.path === path);
        return buffer?.content;
      }
    };
  }
  /**
   * Sign a zip buffer and return the signed buffer
   *
   * @description Sign zipBuffer using the zip file list, private key, and certificate
   * @param fileBuffer
   * @param files
   * @param privatekey
   * @param certificate
   */
  static doSign(fileBuffer, files, privatekey, certificate) {
    const result = SignUtil.unZipFiles(fileBuffer, files);
    if (!result) {
      return false;
    }
    const [chunks] = result;

    // generate the whole-package signature
    SignUtil.signChunk(chunks, privatekey, certificate);
    // write into the zip file
    const signContent = SignUtil.saveChunk(fileBuffer, chunks);
    return signContent;
  }
  /**
   * Parse the buffer
   * @param fileBuffer
   * @param files
   */
  static unZipFiles(fileBuffer, files) {
    // 1. Read the zip file
    if (!fileBuffer || fileBuffer.length <= 4) {
      _sharedUtils.ColorConsole.error('Zip file open failed');
      return false;
    }
    // 2. Check that the file format is valid
    const fileMagic = fileBuffer.readInt32LE(0);
    if (fileMagic !== 0x4034b50) {
      _sharedUtils.ColorConsole.error('Zip file format is wrong');
      return false;
    }
    // 3. Parse data chunks
    const chunks = SignUtil.parserZip(fileBuffer);
    chunks.options = {
      files
    };
    // parse succeeded; build signature chunks
    if (chunks.tag) {
      // process the three signature chunks separately
      Object.keys(chunks.sections).forEach(item => {
        const chunk = chunks.sections[item];
        SignUtil.processChunk(fileBuffer, chunk);
      });
      return [chunks, fileBuffer];
    }
    return false;
  }
  /**
   * Parse a ZIP into data chunks
   * @param fileBuffer
   */
  static parserZip(fileBuffer) {
    let chunk = {
      signchunk: Buffer.from(''),
      tag: false,
      length: fileBuffer.length,
      options: {
        files: []
      },
      sections: {
        header: {
          tag: false,
          startIndex: 0,
          len: 0,
          previous: 0,
          sign: undefined
        },
        central: {
          tag: false,
          startIndex: 0,
          len: 0,
          previous: 0,
          sign: undefined
        },
        footer: {
          tag: false,
          startIndex: 0,
          len: 0,
          previous: 0,
          sign: undefined
        }
      }
    };
    // fileBuffer must be at least 22 bytes
    chunk.sections.footer = SignUtil.readEOCD(fileBuffer);
    if (chunk.sections.footer.tag) {
      chunk.sections.central = SignUtil.readCD(fileBuffer, chunk.sections.footer.previous, chunk.sections.footer.startIndex - chunk.sections.footer.previous);
      if (chunk.sections.central.tag) {
        chunk.sections.header = SignUtil.readFH(fileBuffer, chunk.sections.central.previous, chunk.sections.central.startIndex - chunk.sections.central.previous);
        if (chunk.sections.header.tag) {
          chunk.tag = true;
        }
      }
    }
    return chunk;
  }
  /**
   * Read the buffer from the end; read the trailing buffer
   * @param buffer
   * @returns
   */
  static readEOCD(buffer) {
    let chunk;
    if (buffer && buffer.length >= 22) {
      let offset = buffer.length - 22;
      let tag;
      // walk backward one byte at a time from the start offset and check
      while (offset >= 0) {
        tag = buffer.readInt32LE(offset);
        if (tag === 0x6054b50) {
          // if the start position is found
          chunk = {
            tag: true,
            startIndex: offset,
            len: buffer.length - offset,
            previous: buffer.readInt32LE(offset + 16)
          };
          break;
        }
        offset -= 1;
      }
    }
    return chunk;
  }
  /**
   * Read the middle buffer
   * @param buffer
   * @param offset
   * @param size
   */
  static readCD(buffer, offset, size) {
    let chunk;
    if (buffer && buffer.length >= offset) {
      const tag = buffer.readInt32LE(offset);
      // start position found
      if (tag === 0x2014b50) {
        chunk = {
          tag: true,
          startIndex: offset,
          len: size,
          previous: buffer.readInt32LE(offset + 42)
        };
      }
    }
    return chunk;
  }
  /**
   * Read the leading buffer
   * @param buffer
   * @param offset
   * @param size
   * @returns
   */
  static readFH(buffer, offset, size) {
    let chunk;
    if (buffer && buffer.length >= offset) {
      const tag = buffer.readInt32LE(offset);
      // start position found
      if (tag === 0x4034b50) {
        chunk = {
          tag: true,
          startIndex: offset,
          len: size,
          previous: -1
        };
      }
    }
    return chunk;
  }
  /**
   * Hash a data chunk
   * @param buffer
   * @param chunk
   */
  static processChunk(buffer, chunk) {
    const cur = chunk.startIndex;
    const end = chunk.startIndex + chunk.len;
    // take the buffer contents for this chunk
    const chk = buffer.subarray(cur, end);
    // allocate a Buffer of the given length, zero-filled
    const header = Buffer.alloc(5 + chunk.len);
    // set the first byte
    header[0] = 0xa5;
    // from byte 2, write 4 bytes: chk.length
    header.writeInt32LE(chk.length, 1);
    // from byte 6, copy chk contents
    chk.copy(header, 5);

    // hash the buffer and store it on the chunk
    const signer = _crypto.default.createHash('SHA256');
    signer.update(header);
    chunk.sign = signer.digest();
  }
  static signChunk(chunks, privatekey, certificate) {
    const {
      sections
    } = chunks;

    // concatenate each chunk digest in binary
    let length = 5;
    if (sections.header.sign) {
      length += sections.header.sign.length;
    }
    if (sections.central.sign) {
      length += sections.central.sign.length;
    }
    if (sections.footer.sign) {
      length += sections.footer.sign.length;
    }
    const wholeData = Buffer.alloc(length);
    let offset = 0;
    wholeData.writeInt8(0x5a, 0);
    wholeData.writeInt32LE(3, 1);
    offset += 5;
    function writeBuffer(buf) {
      buf.copy(wholeData, offset);
      offset += buf.length;
    }
    sections.header.sign && writeBuffer(sections.header.sign);
    sections.central.sign && writeBuffer(sections.central.sign);
    sections.footer.sign && writeBuffer(sections.footer.sign);

    // compute the overall digest
    const signer = _crypto.default.createHash('SHA256');
    signer.update(wholeData);
    const signature = signer.digest();

    // build the sign block, compute total length, copy data into buf
    const signchunk = SignUtil.makeSignChunk(chunks.options, signature, privatekey, certificate);
    chunks.signchunk = SignUtil.saveSignChunk(signchunk);
  }
  static makeSignChunk(options, sign, privatekey, certificate) {
    // extract the public key
    const cert = Buffer.from(_Base.default.unarmor(certificate));
    const c = new _jsrsasign.default.X509();
    c.readCertPEM(certificate.toString());
    const pubKey = _jsrsasign.default.KEYUTIL.getPEM(c.getPublicKey());
    // digest block
    const digestBuf = Buffer.alloc(sign.length + 12);
    digestBuf.writeInt32LE(sign.length + 8, 0);
    digestBuf.writeInt32LE(0x0103, 4);
    digestBuf.writeInt32LE(sign.length, 8);
    sign.copy(digestBuf, 12);
    const digestBlock = {
      len: digestBuf.length,
      buffer: digestBuf
    };

    // certificate block
    const certBuf = Buffer.alloc(cert.length + 4);
    certBuf.writeInt32LE(cert.length, 0);
    cert.copy(certBuf, 4);
    const certBlock = {
      len: certBuf.length,
      buffer: certBuf
    };

    // signature data
    const signdataBlock = {
      len: 12,
      digests: {
        size: 0,
        data: []
      },
      certs: {
        size: 0,
        data: []
      },
      additional: 0
    };
    signdataBlock.digests.data.push(digestBlock);
    signdataBlock.digests.size += digestBlock.len;
    signdataBlock.len += digestBlock.len;
    signdataBlock.certs.data.push(certBlock);
    signdataBlock.certs.size += certBlock.len;
    signdataBlock.len += certBlock.len;

    // convert public.pem to DER
    const pubbuf = Buffer.from(_Base.default.unarmor(pubKey));
    const signBlock = {
      len: 16 + pubbuf.length,
      size: 12 + pubbuf.length,
      signdata: {
        size: 0,
        buffer: null
      },
      signatures: {
        size: 0,
        data: []
      },
      pubkey: {
        size: pubbuf.length,
        buffer: pubbuf
      }
    };
    signBlock.signdata.buffer = SignUtil.makeSignDataBuffer(signdataBlock);
    signBlock.signdata.size = signdataBlock.len;
    signBlock.size += signdataBlock.len;
    signBlock.len += signdataBlock.len;

    // generate the signature
    const signature = SignUtil.callCryptoSignFunction(signBlock.signdata.buffer, privatekey, certificate);
    const signatureBlock = {
      len: signature.length + 12,
      size: signature.length + 8,
      id: 0x0103,
      buffer: signature
    };
    signBlock.signatures.data.push(signatureBlock);
    signBlock.signatures.size += signatureBlock.len;
    signBlock.size += signatureBlock.len;
    signBlock.len += signatureBlock.len;
    const signBlocks = {
      len: 4,
      size: 0,
      data: []
    };
    signBlocks.data.push(signBlock);
    signBlocks.size += signBlock.len;
    signBlocks.len += signBlock.len;

    // build key-value
    const kvBlock = {
      len: signBlocks.len + 12,
      size: signBlocks.len + 4,
      id: 0x01000101,
      value: signBlocks
    };
    const signchunk = {
      len: 32,
      size: 24,
      data: []
    };
    signchunk.data.push(kvBlock);
    signchunk.size += kvBlock.len;
    signchunk.len += kvBlock.len;

    // append the file-list hash kvblock
    if (options.files) {
      const filehashChunk = SignUtil.signFiles(options.files, privatekey, certificate);
      if (filehashChunk) {
        const filesignBlocks = {
          len: 4,
          size: 0,
          data: []
        };
        filesignBlocks.data.push(filehashChunk);
        filesignBlocks.size += filehashChunk.length;
        filesignBlocks.len += filehashChunk.length;
        const filekvBlock = {
          len: filesignBlocks.len + 12,
          size: filesignBlocks.len + 4,
          id: 0x01000201,
          value: filesignBlocks
        };
        signchunk.data.push(filekvBlock);
        signchunk.size += filekvBlock.len;
        signchunk.len += filekvBlock.len;
      }
    }
    return signchunk;
  }
  static makeSignDataBuffer(block) {
    const buffer = Buffer.alloc(block.len);
    let offset = 0;
    buffer.writeInt32LE(block.digests.size, offset);
    offset += 4;
    block.digests.data.forEach(item => {
      item.buffer.copy(buffer, offset);
      offset += item.len;
    });
    buffer.writeInt32LE(block.certs.size, offset);
    offset += 4;
    block.certs.data.forEach(item => {
      item.buffer.copy(buffer, offset);
      offset += item.len;
    });
    buffer.writeInt32LE(block.additional, offset);
    return buffer;
  }
  static callCryptoSignFunction(buffer, prikey, certpem) {
    let signature = null;
    if (!_Signer.default.getRemoteCryptoSignFunction()) {
      // use the default
      signature = _Signer.default.defaultCryptoSignFunction(buffer, prikey);
    } else {
      // use external: pass original file contents and certificate contents
      const remoteCryptoSignFunction = _Signer.default.getRemoteCryptoSignFunction();
      signature = remoteCryptoSignFunction(buffer, certpem);
    }
    return signature;
  }
  /**
   * Sign files
   * @param filehashs
   * @param prikey
   * @param certpem
   */
  static signFiles(filehashs, prikey, certpem) {
    const chunk = {
      len: 8,
      size: 4,
      digests: [],
      sign: null
    };
    // build hash chunks
    filehashs.forEach(item => {
      // name hash
      const namehash = _CRC.default.digest(item.name);

      // compute size
      const sum = 6 + item.hash.length;
      const chk = Buffer.alloc(sum);
      let offset = 0;
      chk.writeInt32LE(namehash, offset);
      offset += 4;
      chk.writeInt16LE(item.hash.length, offset);
      offset += 2;
      item.hash.copy(chk, offset);
      offset += item.hash.length;
      chunk.digests.push(chk);
      chunk.size += sum;
      chunk.len += sum;
    });

    // generate the whole-package signature
    SignUtil.signDigestChunk(chunk, prikey, certpem);

    // write the file
    return SignUtil.saveDigestChunk(chunk);
  }
  static signDigestChunk(chunk, prikey, certpem) {
    const buf = Buffer.alloc(chunk.size);
    let offset = 0;
    buf.writeInt32LE(0x0103, offset);
    offset += 4;
    chunk.digests.forEach(chk => {
      chk.copy(buf, offset);
      offset += chk.length;
    });
    chunk.digests = buf.slice();

    // generate the signature
    const signature = SignUtil.callCryptoSignFunction(buf, prikey, certpem);
    chunk.sign = {
      len: 12 + signature.length,
      size: 8 + signature.length,
      id: 0x0103,
      data: signature
    };
    chunk.len += chunk.sign.len;
  }
  static saveDigestChunk(chunk) {
    // create a new buffer
    const newBuffer = Buffer.alloc(chunk.len);
    let offset = 0;
    newBuffer.writeInt32LE(chunk.size, offset);
    offset += 4;

    // file hash list
    chunk.digests.copy(newBuffer, offset);
    offset += chunk.digests.length;

    // write the signature
    newBuffer.writeInt32LE(chunk.sign.size, offset);
    offset += 4;
    newBuffer.writeInt32LE(chunk.sign.id, offset);
    offset += 4;
    newBuffer.writeInt32LE(chunk.sign.data.length, offset);
    offset += 4;
    chunk.sign.data.copy(newBuffer, offset);
    offset += chunk.sign.data.length;
    return newBuffer;
  }
  static SigMagic = 'RPK Sig Block 42';
  static saveSignChunk(signchunk) {
    const buffer = Buffer.alloc(signchunk.len);
    let offset = 0;

    // size
    buffer.writeInt32LE(signchunk.size, offset);
    offset += 4;
    buffer.writeInt32LE(0, offset);
    offset += 4;

    // key-value
    signchunk.data.forEach(kv => {
      buffer.writeInt32LE(kv.size, offset);
      offset += 4;
      buffer.writeInt32LE(0, offset);
      offset += 4;
      buffer.writeInt32LE(kv.id, offset);
      offset += 4;

      // value
      buffer.writeInt32LE(kv.value.size, offset);
      offset += 4;
      if (kv.id === 0x01000101) {
        // sign blocks
        kv.value.data.forEach(block => {
          buffer.writeInt32LE(block.size, offset);
          offset += 4;

          // signdata
          buffer.writeInt32LE(block.signdata.size, offset);
          offset += 4;
          block.signdata.buffer.copy(buffer, offset);
          offset += block.signdata.buffer.length;

          // signature
          buffer.writeInt32LE(block.signatures.size, offset);
          offset += 4;
          block.signatures.data.forEach(signature => {
            buffer.writeInt32LE(signature.size, offset);
            offset += 4;
            buffer.writeInt32LE(signature.id, offset);
            offset += 4;
            buffer.writeInt32LE(signature.buffer.length, offset);
            offset += 4;
            signature.buffer.copy(buffer, offset);
            offset += signature.buffer.length;
          });

          // pubkey
          buffer.writeInt32LE(block.pubkey.size, offset);
          offset += 4;
          block.pubkey.buffer.copy(buffer, offset);
          offset += block.pubkey.buffer.length;
        });
      } else if (kv.id === 0x01000201) {
        // files blocks
        kv.value.data.forEach(block => {
          block.copy(buffer, offset);
          offset += block.length;
        });
      }
    });

    // size
    buffer.writeInt32LE(signchunk.size, offset);
    offset += 4;
    buffer.writeInt32LE(0, offset);
    offset += 4;

    // magic
    const magic = Buffer.from(SignUtil.SigMagic);
    magic.copy(buffer, offset);
    return buffer;
  }
  static saveChunk(buf, chunks) {
    // create a new buffer
    const newBuffer = Buffer.alloc(buf.length + chunks.signchunk.length);
    let offset = 0;
    const sections = chunks.sections;

    // copy header
    buf.copy(newBuffer, offset, sections.header.startIndex, sections.header.startIndex + sections.header.len);
    offset += sections.header.len;

    // copy signblock
    chunks.signchunk.copy(newBuffer, offset);
    offset += chunks.signchunk.length;

    // copy central
    buf.copy(newBuffer, offset, sections.central.startIndex, sections.central.startIndex + sections.central.len);
    offset += sections.central.len;

    // patch eocd
    buf.writeInt32LE(sections.central.startIndex + chunks.signchunk.length, sections.footer.startIndex + 16);
    // copy eocd
    buf.copy(newBuffer, offset, sections.footer.startIndex, sections.footer.startIndex + sections.footer.len);
    offset += sections.footer.len;
    return newBuffer;
  }
  /**
   * Filter out directories and META files
   * @param item
   * @returns
   */
  static fileFilter(item) {
    const path = item.path;
    return !path.endsWith('/') && path !== _ZipUtil.default.CERT_PATH;
  }
}
var _default = exports.default = SignUtil;