#!/usr/bin/env node

"use strict";

var argv   = require('minimist')(process.argv.slice(2));
var root   = argv.path || process.cwd();
var Schema = require('./lib/schema');
var path   = require('path');
var extend = require('extend');
var config = extend(
  require(path.join(root, 'config/connections.js')),
  require(path.join(root, 'config/models.js')),
  require(path.join(root, 'config/local.js'))
);
argv.path  = root;
var knex   = require('./lib/connection')(config, argv.connection);
var schema = new Schema(knex, argv);

schema
  .getSchema(argv.table, argv.database || knex.client.connectionSettings.database)
  .then(schemas => {
    return schema.write(argv.table, schemas);
  })
  .then(() => {
    knex.destroy(() => {
      console.log('> All done! Have fun with your models. :)');
    });
  }).catch(console.error);
