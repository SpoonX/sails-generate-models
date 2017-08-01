"use strict";

var path   = require('path');
var util   = require('util');
var fs     = require('fs');
var pretty = require('js-beautify').js_beautify;

function Schema(knex, options) {
  this.knex          = knex;
  this.options       = options;
  this.modelDir      = path.join(options.path, 'api/models');
  this.controllerDir = path.join(options.path, 'api/controllers');
  options.controller = typeof this.options.controller === 'undefined' ? true : this.options.controller;
}

Schema.prototype.getTables = function(database) {
  database = database || this.options.database;

  return this.knex
    .from('information_schema.tables')
    .where({table_schema: database})
    .pluck('table_name');
};

Schema.prototype.getSchemas = function(tables, database) {
  var tasks   = [];
  var schemas = {};

  tables.forEach(table => {
    tasks.push(this.getSchema(table, database)
      .then(schema => {
        schemas[table] = schema;
      })
    );
  });

  return Promise.all(tasks).then(() => schemas);
};

Schema.prototype.getAllSchemas = function(database) {
  return this.getTables(database)
    .then(tables => {
      return this.getSchemas(tables, database);
    });
};

Schema.prototype.getSchema = function(table, database) {
  table    = table || this.options.table;
  database = database || this.options.database;

  if (!table) {
    return this.getAllSchemas(database);
  }

  return this.knex
    .select(
      'col.column_name',  // name
      'col.data_type',    // type
      'tbl.table_name',   // table name
      'tbl.table_type',    // table type
      'col.extra',        // Auto increment
      'col.column_key',   // index / primaryKey
      'col.column_type',  // For length of int and varchar
      'col.is_nullable',   // nullable (required)
      'col.column_default', // default value
      'usg.referenced_table_name' // referenced model
    )
    .from('information_schema.columns as col')
    .leftJoin('INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS usg', function() {
      this.on('col.table_schema', '=', 'usg.table_schema').andOn('col.table_schema', '=', 'usg.table_schema').andOn('col.column_name', '=', 'usg.column_name')
    })
    .leftJoin('INFORMATION_SCHEMA.TABLES AS tbl', function() {
        this.on('col.table_name', '=', 'tbl.table_name')
    })
    .where({
      'col.table_schema': database || this.options.db,
      'col.table_name'  : table
    })
    .orderBy('col.ordinal_position', 'asc')
    .then(schema => {
      return generateModel(schema);
    });
};

Schema.prototype.writeController = function(name) {
  name = ucwords(name)+'Controller.js';

  return writeFile(this.controllerDir, name, pretty(`
    /**
     * ${name}
     *
     * @description :: Server-side logic for managing subscriptions
     * @help        :: See http://links.sailsjs.org/docs/controllers
     */

    module.exports = {
    };
  `, {indent_size: 2}));
}

Schema.prototype.writeModel = function(name, schema) {
  var modelData = schema;

  name = ucwords(name)+'.js';

  return writeFile(this.modelDir, name, pretty(`
    /**
     * ${name}
     *
     * @description :: The ` + name.substring(0, name.length - 3) + ` table
     * @docs        :: http://sailsjs.org/#!documentation/models
     */

    module.exports = ${util.inspect(modelData, {depth: 5})};
  `, {indent_size: 2}));
};

Schema.prototype.write = function(name, schema) {
  var writePromises = [];
  if (!name) {

    Object.getOwnPropertyNames(schema).forEach(model => {
      writePromises.push(this.write(model, schema[model]));
    }, this);

    return Promise.all(writePromises);
  }

  writePromises.push(this.writeModel(name, schema));


  if (this.options.controller) {
    writePromises.push(this.writeController(name));
  }

  return Promise.all(writePromises);
}

// ===== Functions =====
function generateModel(schema) {
  var model = {}, modelAttributes = {}, relationships = [], table, identity, primaryKey, isView = false;

  schema.forEach(definition => {

    table = definition.table_name;
    identity = ucwords(definition.table_name).toLowerCase();

    if(definition.table_type === 'VIEW'){
        isView = true;
        modelAttributes['id'] = { type: 'number', required: true };
    }
    modelAttributes[ucwords(definition.column_name)] = generateColumn(definition);

    if (definition.column_key === 'PRI') {
        primaryKey = ucwords(definition.column_name);
    }

    if (definition.referenced_table_name) {

      var addRel = true;
      relationships.forEach(rel => {
          if(rel.hasOwnProperty(ucwords(definition.referenced_table_name).toLowerCase())){
              addRel = false;
          }
      });

      if(addRel){
          var relationship = Object();
          relationship[ucwords(definition.referenced_table_name).toLowerCase()] = { model: {} };
          relationship[ucwords(definition.referenced_table_name).toLowerCase()].model = ucwords(definition.referenced_table_name).toLowerCase();
          relationships.push(relationship);
      }
    }
  });

  model = { identity: identity, tableName: table, schema: true, attributes: modelAttributes, migrate: 'safe'/*, autoPK: false, autoCreatedAt: false, autoUpdatedAt: false*/ };

  if(!isView){
      Object.assign(model, { primaryKey: primaryKey });
  }

  relationships.forEach(rel => {
      if(rel){
          Object.assign(model, rel);
      }
  });

  return model;
}

function generateColumn(definition) {
  var required = definition.is_nullable.toLowerCase() === 'no';
  var column   = {
    type      : getType(definition.data_type),
    required  : required
  };

  if(definition.is_nullable.toLowerCase() !== 'no'){
      column.allowNull = true;
  }
  if(definition.data_type === 'datetime') {
      column.columnType = definition.data_type;
  }
  column.columnName = definition.column_name;

  if (definition.extra.search('auto_increment') > -1) {
    column.autoIncrement = true;
  }

  if (definition.column_key.length) {
    if (definition.column_key === 'MUL') {
      //column.index = true;
    } else if (definition.column_key === 'PRI') {
      //column.primaryKey = true;
    } else if (definition.column_key === 'UNI') {
      column.unique = true;
    }
  }

  if (definition.data_type === 'enum') {
    column.isIn = eval('[' + definition.column_type.match(/enum\((.*?)\)/)[1] + ']');
  }

  if ((definition.column_default || definition.is_nullable.toLowerCase() !== 'no') && !column.hasOwnProperty('required') && !definition.referenced_table_name) {
    column.defaultsTo = definition.column_default || '';
  }

  return column;
}

function getType(type) {
  switch (type) {
    case 'bool':
      return 'boolean';

    case 'mediumint':
    case 'bigint':
    case 'smallint':
    case 'tinyint':
    case 'timestamp':
    case 'int':
      return 'number';

    case 'char':
    case 'enum':
    case 'varchar':
    case 'tinytext':
    case 'text':
    case 'datetime':
    case 'longtext':
    case 'mediumtext':
      return 'string';

    case 'json':
    case 'float':
    case 'double':
    case 'tinyblob':
    case 'blob':
    case 'mediumblob':
    case 'longblob':
    case 'date':
    case 'time':
    case 'decimal':
      return type;

    default:
      throw 'Unknown column type "' + type + '" provided.'
  }
}

function ucwords(name) {
  return name.replace(/_/g, ' ').replace(/(?:^\w|[A-Z]|\b\w)/g, function(letter, index) {
      return index === 0 ? letter.toLowerCase() : letter.toUpperCase();
  }).replace(/\s+/g, '');
}

function writeFile(dir, name, contents) {
  return new Promise((resolve, reject) => {
    var filePath = path.join(dir, name);

    console.log(`- Writing ${name}...`);
    fs.writeFile(filePath, contents, error => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

module.exports = Schema;
