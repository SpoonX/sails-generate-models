# Sails-generate-models
Generate models (and controllers) based on your database schema.

## Warning
This was built for a specific task, and has only been tested on MySQL.

## Usage

First install globally:

`npm i -g sails-generate-models`

Then in your sails project root you can run:

`sails-generate-models`

### Options
* --path=/path/to/sails-project (defaults to cwd)
* --connection=connectionToUse (defaults to default connection)
* --table=tableToGenerateFor (defaults to all)
* --database=databaseToGenerateFor (defaults to default connection's db)
* --controller (create controller, too? Defaults to controller)
