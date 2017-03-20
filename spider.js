const Promise = require("bluebird"),
  _ = require("lodash"),
  Path = require("path"),
  cp = require("child_process"),
  fs = Promise.promisifyAll(require("fs")),
  colors = require("colors");

class Spider {
  constructor(path, verbose) {
    this.path = path;
    this.verbose = verbose;

    this.addedModules = [];
    this.erroring = [];
    this.good = [];
    this.savedPackages = [];

    this.managerDict = {
      npm: {
        install: 'npm i',
        add: 'npm i'
      },
      yarn: {
        install: 'yarn',
        add: 'yarn add'
      }
    }

    this.manager = 'npm';

    if (fs.existsSync('./yarn.lock')) {
      this.manager = 'yarn';
    }

    this.tries = 0;
    this.childLife = 10 * 1000;
    console.log(`Crawling ${path} ${this.verbose ? 'in verbose mode' : ''}`);

    const initCmd = `rm -rf ./node_modules && ${this.managerDict[this.manager].install}`;

    cp.exec(initCmd, () => {
      this.run(this.path)
    });
  }

  checkFile(path) {
    return new Promise(res => {

      const child = cp.spawn('node', [path])

      let childAlive = true;
      setTimeout(() => {
        if (childAlive) {
          child.kill();
          return res({ path, err: `Process took too long to exit` });
        }
      }, this.childLife)

      if (this.verbose) {
        child.stdout.on('data', data => {
          console.log(`stdout: ${data}`);
        })
      }
      let err = '';

      child.stderr.on('data', data => {
        if (this.verbose) { console.error(`stderr: ${data}`) }
        data = data.toString();
        if (data.indexOf(`Cannot find module`) > -1 || data.indexOf('module.js:457') > -1) {
          try {
            const missing_module = data.split("Cannot find module")[1].split("at")[0].trim();
            if (missing_module.indexOf(".") > -1) {
              this.erroring.push(path)
              return res({
                path,
                err: data
              });
            } else {
              this.addedModules.push(missing_module);
              return res({ path });
            }
          } catch (err) {}
        } else {
          err += data;
        }
      })

      child.on('close', (code) => {
        childAlive = false;
        if (this.verbose) console.log(colors.grey(`Process exited with status code: ${code}`));
        if (code === 1) {
          this.erroring.push(path);
          return res({
            path,
            err: err
          });
        }
        this.good.push(path);
        return res({ path });
      })

    })
  }

  getPaths(origin) {
    console.log(`Getting paths for ${origin}`);
    return fs.readdirAsync(origin)
      .then(contents => contents.filter(path => path.indexOf('node_modules') === -1))
      .then(contents => contents.filter(path => {
        const split_path = path.split("/");
        return !split_path[split_path.length - 1].startsWith(".")
      }))
      .then(files => files.map(file => Path.resolve(origin, file)))
      .then(files => {
        return files.map(file => {
          console.log(colors.grey(`Statting ${file}`));
          return (fs.statAsync(file)
            .then(stat => ({
              isDir: stat.isDirectory(),
              fileName: file
            }))
          )
        })
      })
      .then(promises => Promise.all(promises))
      .then(data => data.filter(info => {
        if (info.isDir) {
          return info
        } else {
          if (info.fileName.endsWith('.js')) return info;
        }
      }))
      .then(infos => Promise.map(infos, (info => {
        if (info.isDir) {
          return this.getPaths(info.fileName)
        } else {
          return Promise.resolve(info.fileName);
        }
      })))
      .then(files => _.compact(_.flattenDeep(files)))
  }

  run(path) {

    if (this.tries >= 2) {
      console.log(`We tried 5 times, gonna stop now :(`)
      process.exit(0);
    }

    return fs.statAsync(path)
      .then(stats => {
        const isDir = stats.isDirectory();
        if (isDir) {
          const package_path = Path.resolve(path, './package.json')
          if (fs.existsSync(package_path)) {
            const data = JSON.parse(fs.readFileSync(package_path));
            Object.keys(data.dependencies)
              .forEach(dep => this.savedPackages.push(dep));
          }
          return this.getPaths(path)
            .then(paths => Promise.map(paths, path => this.checkFile(path)))
        } else {
          return this.checkFile(path)
        }
      })
      .then(() => {
        console.log(colors.cyan(`Installed packages: ${this.savedPackages.length ? colors.green(this.savedPackages.join(", ")) : colors.yellow('Unavailable')}`));
        console.log(colors.cyan(`Fatal crashes from: ${this.erroring.length ? colors.red(this.erroring) : colors.green('none')}`));
        console.log(colors.cyan(`Modules to add: ${this.addedModules.length ? colors.red(this.addedModules) : colors.green('none')}`));
        if (!this.erroring.length && !this.addedModules.length) {
          console.log(colors.green(`Yay! No problems in that code!`));
        }
      })
      .catch(err => {
        console.error(`Could not get stats on path -- ${err}`);
        process.exit(1);
      })
  }
}

module.exports = Spider;
