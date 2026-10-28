"use strict";

const JSZip = require("jszip");

class ZipUtil {
  static DIGEST_HASH_JSON = "hash.json";
  static META_PATH = "META-INF";
  static CERT_PATH = "META-INF/CERT";
  static BUILD_FILE_PATH = "META-INF/build.txt";
  static ZIP_OPTION = {
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  };

  static async createZipBufferFromFileList(fileList, comment) {
    const zip = new JSZip();
    fileList.forEach((item) => {
      zip.file(item.path, item.content);
    });
    return zip.generateAsync({
      ...this.ZIP_OPTION,
      comment,
    });
  }
}

module.exports = ZipUtil;
module.exports.default = ZipUtil;
