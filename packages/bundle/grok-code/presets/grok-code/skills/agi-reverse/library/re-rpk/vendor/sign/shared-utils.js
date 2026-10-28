"use strict";

const crypto = require("crypto");
const fs = require("fs");

const ColorConsole = {
  error(...args) {
    console.error(...args);
  },
  info() {},
  throw(...args) {
    throw new Error(args.map(String).join(" "));
  },
};

const CommonUtil = {
  calcDataDigest(buffer) {
    return crypto.createHash("SHA256").update(buffer).digest();
  },
};

const FileUtil = {
  checkFilePath(paths) {
    return paths.every((p) => fs.existsSync(p));
  },
};

module.exports = { ColorConsole, CommonUtil, FileUtil };
