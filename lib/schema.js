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
      'col.extra',        // Auto increment
      'col.column_key',   // index / primaryKey
      'col.column_type',  // For length of int and varchar
      'col.is_nullable',   // nullable (required)
      'col.column_default', // default value
      'usg.referenced_table_name' // referenced model
    )
    .from('information_schema.columns as col')
    .join('INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS usg', function() {
      this.on('col.table_schema', '=', 'usg.table_schema').andOn('col.table_schema', '=', 'usg.table_schema').andOn('col.column_name', '=', 'usg.column_name')
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
  name = ucfirst(name)+'Controller.js';

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
  var modelData = {
    tableName: name,
    autoCreatedAt: false,
    autoUpdatedAt: false,
    attributes: schema
  };

  name = ucfirst(name)+'.js';

  return writeFile(this.modelDir, name, pretty(`
    /**
     * ${name}
     *
     * @description :: TODO: You might write a short summary of how this model works and what it represents here.
     * @docs        :: http://sailsjs.org/#!documentation/models
     */

    module.exports = ${util.inspect(modelData, {depth: 5})};
  `, {indent_size: 2}));
};

Schema.prototype.write = function(name, schema, controller) {
  if (!name) {
    var writePromises = [];

    Object.getOwnPropertyNames(schema).forEach(model => {
      writePromises.push(this.write(model, schema[model]));
    }, this);

    return Promise.all(writePromises);
  }

  var writePromises = [];

  writePromises.push(this.writeModel(name, schema));


  if (this.options.controller) {
    writePromises.push(this.writeController(name));
  }

  return Promise.all(writePromises);
}

// ===== Functions =====
function generateModel(schema) {
  var modelAttributes = {};

  if (!Array.isArray(schema)) {
    Object.getOwnPropertyNames(schema).forEach(model => {
      modelAttributes[model] = generate(schema[model]);
    });

    return modelAttributes;
  }

  schema.forEach(definition => {
    modelAttributes[definition.column_name] = generateColumn(definition);
  });

  return modelAttributes;
}

function generateColumn(definition) {
  var required = definition.is_nullable.toLowerCase() === 'no';
  var column   = {
    type      : getType(definition.data_type),
    required  : required
  };
  var size;

  if (definition.extra.search('auto_increment') > -1) {
    column.autoIncrement = true;
  }

  if (definition.column_key.length) {
    if (definition.column_key === 'MUL') {
      column.index = true;
    } else if (definition.column_key === 'PRI') {
      column.primaryKey = true;
    } else if (definition.column_key === 'UNI') {
      column.unique = true;
    }
  }

  if (definition.data_type === 'enum') {
    column.enum = eval('[' + definition.column_type.match(/enum\((.*?)\)/)[1] + ']');
  }

  size = definition.column_type.match(/\((\d+)\)/);

  if (['integer', 'string'].indexOf(column.type) > -1 && size !== null) {
    column.size = parseInt(size[1]);
  }

  if (!definition.column_default && definition.is_nullable.toLowerCase() === 'no') {}
  else
    column.defaultsTo = definition.column_default;

  if (definition.referenced_table_name)
    column.model = definition.referenced_table_name;

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
      return 'integer';

    case 'char':
    case 'enum':
    case 'varchar':
    case 'tinytext':
      return 'string';

    case 'json':
    case 'longtext':
    case 'mediumtext':
    case 'datetime':
    case 'float':
    case 'double':
    case 'tinyblob':
    case 'blob':
    case 'mediumblob':
    case 'longblob':
    case 'date':
    case 'text':
    case 'time':
    case 'datetime':
    case 'decimal':
      return type;

    default:
      throw 'Unknown column type "' + type + '" provided.'
  }
}

function ucfirst(name) {
  return name[0].toUpperCase() + name.substr(1);
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
