require('dotenv').config();

var minimist = require('minimist');
var crypto = require('crypto');
var request = require('request');
var MongoClient = require('mongodb').MongoClient;
var AWS = require('aws-sdk');
var S3 = new AWS.S3();

var PARSE_URL_BASE = 'http://files.parsetfss.com';
var LEGACY_FILES_PREFIX_REGEX = new RegExp("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-");
var MIGRATED_FILE_PREFIX = 'mfp_';

function percentage(slice, total) {
	return Math.round((slice / total * 100) * 100) / 100;
}

function connectToDatabase() {
	return new Promise(function(resolve, reject) {
		MongoClient.connect(process.env.DATABASE_URI, function(error, db) {
			if (error)
				return reject(error);
			return resolve(db);
		});
	});
}

function toParseFileUrl(fileName) {
	return [
		PARSE_URL_BASE,
		process.env.PARSE_FILE_KEY,
		fileName
	].join('/');
}

function fileNameFromParseFileUrl(url) {
	var fileName = url;
	var prefix = PARSE_URL_BASE + '/' + process.env.PARSE_FILE_KEY + '/';
	if (url.indexOf(prefix) !== -1) {
		fileName = fileName.replace(prefix, '');
	}
	return fileName;
}

function createNewFileName(fileName) {
  if (isParseHostedFile(fileName)) {
    fileName = fileName.replace('tfss-', '');
    var newPrefix = crypto.randomBytes(32/2).toString('hex');
    fileName = newPrefix + fileName.replace(LEGACY_FILES_PREFIX_REGEX, '');
  }
  return MIGRATED_FILE_PREFIX + fileName;
}

function isParseHostedFile(fileName) {
  if (fileName.indexOf('tfss-') === 0 || LEGACY_FILES_PREFIX_REGEX.test(fileName)) {
    return true;
  }
  return false;
}

function uploadToS3(url, fileName) {
	return new Promise(function(resolve, reject) {
		request({
			url: url,
			encoding: null
		}, function(error, response, body) {
			if (error)
				return reject(error);

			S3.putObject({
				Bucket: process.env.TARGET_S3_BUCKET,
				Key: fileName,
				ACL: 'public-read',
	      ContentType: response.headers['content-type'],
	      ContentLength: response.headers['content-length'],
	      Body: body // buffer
			}, function(error) {
				if (error)
					return reject(error);

				var newUrl = 'https://' + process.env.TARGET_S3_BUCKET + '.s3.amazonaws.com/' + fileName;
				return resolve(newUrl);
			});
		});
	});
}

function processDoc(collection, doc, propertyName) {
	console.log('Processing doc: ' + doc._id);
	
	var newFileName = createNewFileName(doc[propertyName]);
	var currentFileUrl = toParseFileUrl(doc[propertyName]);

	return uploadToS3(currentFileUrl, newFileName).then(function(newUrl) {
		var updateQuery = {
			'$set': {}
		};
		updateQuery['$set'][propertyName] = newFileName;
		return collection.update({ '_id': doc._id }, updateQuery);
	});	
}

/* ===================== */

var args = minimist(process.argv.slice(2));

var COLLECTION = args.collection;
var PROPERTY = args.property;
var BATCH_SIZE = args.batchSize || 10;

if (!COLLECTION || !PROPERTY || BATCH_SIZE <= 0) {
	console.log('Sample usage: node index.js --collection=Photo --property=imageFile --batchSize=10');
	return;
}

console.log('=== STARTING ===');
var db;
connectToDatabase().then(function(database) {
	db = database;

	var query = {};
	query[PROPERTY] = {
		'$regex': '^tfss'
	};
	return db.collection(COLLECTION).find(query, { timeout: false });

}).then(function(cursor) {
	var total = 0;
	return cursor.count().then(function(count) {
		total = count;
		return cursor;

	}).then(function(cursor) {
		return new Promise(function(resolve, reject) {

			var index = 0;
			var batch = [];
			cursor = cursor.batchSize(BATCH_SIZE);

			var doNext = function(error, doc) {
				if (error)
					return reject(error);

				if (doc) {
					index++;
					batch.push(doc);
				}

				if (batch.length === BATCH_SIZE || (!doc && batch.length > 0)) {
					process.nextTick(function() {
						console.log('=== Processing ' + index + ' out of ' + total + ' (' + percentage(index, total) + '%) ===');
						var promises = batch.map(function(doc) {
							return processDoc(db.collection(COLLECTION), doc, PROPERTY);
						});
						Promise.all(promises).then(function() {
							if (cursor.isClosed())
								return resolve();

							batch = [];
							cursor.nextObject(doNext);

						}).catch(function(error) {
							reject(error);
						});
					});
				}
				else if (doc) {
					cursor.nextObject(doNext);
				}
				else {
					resolve();
				}
			};

			cursor.nextObject(doNext);
		});

	});

}).then(function() {
	console.log('=== All done! ===');

}).catch(function(error) {
	console.log('ERROR');
	console.log(error);

}).then(function() {
	if (db)
		db.close();
});

