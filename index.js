#! /usr/bin/env node

const cp = require("child_process"),
  Path = require("path"),
  args = require("yargs").argv,
  verbose = args['v'],
  force = args['f'],
  path = Path.resolve(args._[0] || '.'),
  Spider = require("./spider.js");


new Spider(path, {
  verbose,
  force
});