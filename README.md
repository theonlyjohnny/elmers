# Elmer

Handy little tool to check for missing dependencies

# How it works

Elmer checks every file in a given path, runs it as a JS file in a child process, and reports back. It will let you know if:

* You reference a module not in your package.json
* A file is crashing
* A package is out of date

# Installation

Elmer is availble on [npm](https://www.npmjs.com/package/elmers), so to use simply run `npm install elmers -g` :)

# Why it's helpful

Too many times have people run into problems where someone has a node module installed but not saved, so when testing locally it seems to be fine, but when pushed, it fails. With Elmer, you can quickly make sure you didn't forget anything, as well as run a quick check of all your recent code. 

# What does it work with?

Elmer works best with _Pure Node_ programs, meaning nothing with too much uncompiled ES6 or React JSX. Support for those will come, but since Node doesn't always understand ES6 (i.e `import`) it can say a file is broken when it's not.

Elmer works with `yarn` and `npm` to install missing dependencies and update them

# How do I use it?

It's simple! Navigate to whichever project you want to test in your terminal. Then, simply type `elmer` and sit back. Elmer also accepts 2 optional args, `-v` and `-f`. Appending `-v` to your command will run Elmer verbosely, which means it will tell you which packages are out of date, as well as show you error logs if any file(s) failed. Appending `-f` to you command will tell Elmer you want it to update everything for you. This means Elmer will try to update all your dependencies and install any missing ones.