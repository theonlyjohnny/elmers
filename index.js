#! /usr/bin/env node

const Promise = require("bluebird"),
  _ = require("lodash"),
  Path = require("path"),
  cp = require("child_process"),
  fs = Promise.promisifyAll(require("fs")),
  colors = require("colors"),
  args = require("yargs").argv,
  verbose = args['v'],
  path = Path.resolve(args._[0] || '.');

console.log(`Crawling ${path}`);

checkFile = (path) => {
  return new Promise((res, rej) => {

    const child = cp.spawn('node', [path])

    if (verbose) {
      child.stdout.on('data', data => {
        console.log(`stdout: ${data}`);
      })
    }

    child.stderr.on('data', data => {
      data = data.toString();
      if (data.indexOf(`Cannot find module`) || data.indexOf('module.js:457')) {
        try {
          const missing_module = data.split("Cannot find module")[1].split("at")[0].trim();
          if (missing_module.indexOf(".") > -1) {
            return rej(`Other err: ${data}`);
          } else {
            return rej(`Module: ${missing_module}`);
          }
        } catch (err) {}
      }
      return rej(`Other err: ${data}`);
    })

    child.on('close', () => {
      return res();
    })

  })
}

getPaths = (origin) => {
  console.log(`Getting paths for ${origin}`);
  return fs.readdirAsync(origin)
    .then(contents => contents.filter(path => path.indexOf('node_modules') === -1))
    .then(contents => contents.filter(path => {
      const split_path = path.split("/");
      return !split_path[split_path.length - 1].startsWith(".")
    }))
    .then(files => files.map(file => Path.resolve(origin, file)))
    .then(files => {
      const promises = []
      files.forEach(file => {
        console.log(colors.grey(`Checking ${file}`));
        promises.push(fs.statAsync(file)
          .then(stat => ({
            isDir: stat.isDirectory(),
            fileName: file
          }))
        )
      })
      return promises;
    })
    .then(promises => Promise.all(promises))
    .then(all => Promise.map(all, (info => {
      const split_name = info.fileName.split(".");
      if (info.isDir) {
        return getPaths(info.fileName);
      } else if (split_name[split_name.length - 1] === ".js") {
        return info.fileName;
      }
    })))
    .then(files => _.compact(_.flattenDeep(files)));
}


const run = (path, tries = 0) => {
  // console.log(colors.yellow(`\n \n RUNNING \n \n`));
  if (tries >= 2) {
    console.log(`We tried 5 times, gonna stop now :(`)
    process.exit(0);
  }
  const addedModules = [];
  const erroring = [];
  const good = [];
  return fs.statAsync(path)
    .then(stats => {
      const isDir = stats.isDirectory();
      if (!isDir) {
        return checkFile(path)
          .then(() => {
            good.push(path);
          })
          .catch(err => {
            if (err.match(/Module:\ (\'.*\')/)) {
              addedModules.push(err.split(":")[1].trim());
            } else {
              erroring.push(path);
            }
          })
      } else {
        return getPaths(path)
          .then(paths => Promise.map(paths, path => {
            return checkFile(path)
              .then(() => {
                good.push(path)
              })
              .catch(err => {
                if (err.match(/Module:\ (\'.*\')/)) {
                  console.log(colors.red(err));
                  addedModules.push(err.split(":")[1].trim());
                } else {
                  erroring.push(path);
                }
              })
          }))
      }
    })
    .then(() => {
      console.log(colors.cyan(`Erroring files: ${erroring.length ? colors.red(erroring) : colors.green('none')}`));
      console.log(colors.cyan(`Modules to add: ${addedModules.length ? colors.red(addedModules) : colors.green('none')}`));
      if (!erroring.length && !addedModules.length) {
        console.log(colors.green(`Yay! No problems in that code!`));
      }
    })
    .catch(err => {
      console.error(`Could not get stats on path -- ${err} ${err.stack}`);
      process.exit(1);
    })
}


let cmd;

if (fs.existsSync('./yarn.lock')) {
  cmd = 'yarn';
}

cp.exec(`rm -rf ./node_modules && ${cmd ? cmd : 'npm i'}`, () => {
  run(path)
});
