#! /usr/bin/env node

const cp = require("child_process"),
  Path = require("path"),
  args = require("yargs").argv,
  verbose = args['v'],
  path = Path.resolve(args._[0] || '.'),
  Spider = require("./spider.js");


new Spider(path, verbose);
