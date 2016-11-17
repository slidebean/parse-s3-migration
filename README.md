# parse-s3-migration
Migrate files from Parse to your own S3. This node app does the following:

1. Connects directly to your MongoDB instance.
2. Given a Collection name which has a file property, it looks for all documents which have a reference to a file stored in Parse's S3 bucket (i.e. strings matching the `^tfss` regex).
3. For each document:
    1. Downloads the file from Parse S3.
    2. Uploads the file to your S3 bucket.
    3. Updates the document with the new file url.

## Disclaimer!
We provide no guarantees regarding this software. Please use at your discretion. That being said, it worked like a charm for us ¯\\\_(ツ)_/¯


## Installation

* Clone and run `npm install` in your favorite terminal.
* Fill out the `.env` file with your Parse and AWS keys.

## Sample Usage

Say you have a Parse collection named `Photo`, with a property named `imageFile` of type `Parse.File`. Simply run:

```
node index.js --collection=Photo --property=imageFile
```

By default, the `batchSize` is 10, but you can tweak it as you see fit. Example:

```
node index.js --collection=Photo --property=imageFile --batchSize=20
```

## Notes
* Handles one property per one collection at a time.
* Aborts the process when an error is encountered.