// Copyright IBM Corp. 2012,2016. All Rights Reserved.
// Node module: loopback-datasource-juggler
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT
'use strict';

exports.safeRequire = safeRequire;
exports.fieldsToArray = fieldsToArray;
exports.selectFields = selectFields;
exports.removeUndefined = removeUndefined;
exports.parseSettings = parseSettings;
exports.mergeSettings = exports.deepMerge = deepMerge;
exports.deepMergeProperty = deepMergeProperty;
exports.isPlainObject = isPlainObject;
exports.defineCachedRelations = defineCachedRelations;
exports.sortObjectsByIds = sortObjectsByIds;
exports.setScopeValuesFromWhere = setScopeValuesFromWhere;
exports.mergeQuery = mergeQuery;
exports.mergeIncludes = mergeIncludes;
exports.createPromiseCallback = createPromiseCallback;
exports.uniq = uniq;
exports.toRegExp = toRegExp;
exports.hasRegExpFlags = hasRegExpFlags;
exports.idEquals = idEquals;
exports.findIndexOf = findIndexOf;
exports.collectTargetIds = collectTargetIds;
exports.idName = idName;
exports.rankArrayElements = rankArrayElements;
exports.idsHaveDuplicates = idsHaveDuplicates;

var g = require('strong-globalize')();
var traverse = require('traverse');
var assert = require('assert');

function safeRequire(module) {
  try {
    return require(module);
  } catch (e) {
    g.log('Run "{{npm install loopback-datasource-juggler}} %s" command ',
      'to use {{loopback-datasource-juggler}} using %s database engine',
      module, module);
    process.exit(1);
  }
}

/*
 * Extracting fixed property values for the scope from the where clause into
 * the data object
 *
 * @param {Object} The data object
 * @param {Object} The where clause
 */
function setScopeValuesFromWhere(data, where, targetModel) {
  for (var i in where) {
    if (i === 'and') {
      // Find fixed property values from each subclauses
      for (var w = 0, n = where[i].length; w < n; w++) {
        setScopeValuesFromWhere(data, where[i][w], targetModel);
      }
      continue;
    }
    var prop = targetModel.definition.properties[i];
    if (prop) {
      var val = where[i];
      if (typeof val !== 'object' || val instanceof prop.type ||
          prop.type.name === 'ObjectID' || // MongoDB key
          prop.type.name === 'uuidFromString') { // C*
        // Only pick the {propertyName: propertyValue}
        data[i] = where[i];
      }
    }
  }
}

/**
 * Merge include options of default scope with runtime include option.
 * exhibits the _.extend behaviour. Property value of source overrides
 * property value of destination if property name collision occurs
 * @param {String|Array|Object} destination The default value of `include` option
 * @param {String|Array|Object} source The runtime value of `include` option
 * @returns {Object}
 */
function mergeIncludes(destination, source) {
  var destArray = convertToArray(destination);
  var sourceArray = convertToArray(source);
  if (destArray.length === 0) {
    return sourceArray;
  }
  if (sourceArray.length === 0) {
    return destArray;
  }
  var relationNames = [];
  var resultArray = [];
  for (var j in sourceArray) {
    var sourceEntry = sourceArray[j];
    var sourceEntryRelationName = (typeof (sourceEntry.rel || sourceEntry.relation) === 'string') ?
      sourceEntry.relation : Object.keys(sourceEntry)[0];
    relationNames.push(sourceEntryRelationName);
    resultArray.push(sourceEntry);
  }
  for (var i in destArray) {
    var destEntry = destArray[i];
    var destEntryRelationName = (typeof (destEntry.rel || destEntry.relation) === 'string') ?
      destEntry.relation : Object.keys(destEntry)[0];
    if (relationNames.indexOf(destEntryRelationName) === -1) {
      resultArray.push(destEntry);
    }
  }
  return resultArray;
}

/**
 * Converts input parameter into array of objects which wraps the value.
 * "someValue" is converted to [{"someValue":true}]
 * ["someValue"] is converted to [{"someValue":true}]
 * {"someValue":true} is converted to [{"someValue":true}]
 * @param {String|Array|Object} param - Input parameter to be converted
 * @returns {Array}
 */
function convertToArray(include) {
  if (typeof include === 'string') {
    const obj = {};
    obj[include] = true;
    return [obj];
  } else if (isPlainObject(include)) {
    // if include is of the form - {relation:'',scope:''}
    if (include.rel || include.relation) {
      return [include];
    }
    // Build an array of key/value pairs
    var newInclude = [];
    for (var key in include) {
      const obj = {};
      obj[key] = include[key];
      newInclude.push(obj);
    }
    return newInclude;
  } else if (Array.isArray(include)) {
    var normalized = [];
    for (var i in include) {
      var includeEntry = include[i];
      if (typeof includeEntry === 'string') {
        const obj = {};
        obj[includeEntry] = true;
        normalized.push(obj);
      } else {
        normalized.push(includeEntry);
      }
    }
    return normalized;
  }
  return [];
}

/*!
 * Merge query parameters
 * @param {Object} base The base object to contain the merged results
 * @param {Object} update The object containing updates to be merged
 * @param {Object} spec Optionally specifies parameters to exclude (set to false)
 * @returns {*|Object} The base object
 * @private
 */
function mergeQuery(base, update, spec) {
  if (!update) {
    return;
  }
  spec = spec || {};
  base = base || {};

  if (update.where && Object.keys(update.where).length > 0) {
    if (base.where && Object.keys(base.where).length > 0) {
      base.where = {and: [base.where, update.where]};
    } else {
      base.where = update.where;
    }
  }

  // Merge inclusion
  if (spec.include !== false && update.include) {
    if (!base.include) {
      base.include = update.include;
    } else {
      if (spec.nestedInclude === true) {
        // specify nestedInclude=true to force nesting of inclusions on scoped
        // queries. e.g. In physician.patients.find({include: 'address'}),
        // inclusion should be on patient model, not on physician model.
        var saved = base.include;
        base.include = {};
        base.include[update.include] = saved;
      } else {
        // default behaviour of inclusion merge - merge inclusions at the same
        // level. - https://github.com/strongloop/loopback-datasource-juggler/pull/569#issuecomment-95310874
        base.include = mergeIncludes(base.include, update.include);
      }
    }
  }

  if (spec.collect !== false && update.collect) {
    base.collect = update.collect;
  }

  // Overwrite fields
  if (spec.fields !== false && update.fields !== undefined) {
    base.fields = update.fields;
  } else if (update.fields !== undefined) {
    base.fields = [].concat(base.fields).concat(update.fields);
  }

  // set order
  if ((!base.order || spec.order === false) && update.order) {
    base.order = update.order;
  }

  // overwrite pagination
  if (spec.limit !== false && update.limit !== undefined) {
    base.limit = update.limit;
  }

  var skip = spec.skip !== false && spec.offset !== false;

  if (skip && update.skip !== undefined) {
    base.skip = update.skip;
  }

  if (skip && update.offset !== undefined) {
    base.offset = update.offset;
  }

  return base;
}

/**
 * Normalize fields to an array of included properties
 * @param {String|String[]|Object} fields Fields filter
 * @param {String[]} properties Property names
 * @param {Boolean} excludeUnknown To exclude fields that are unknown properties
 * @returns {String[]} An array of included property names
 */
function fieldsToArray(fields, properties, excludeUnknown) {
  if (!fields) return;

  // include all properties by default
  var result = properties;
  var i, n;

  if (typeof fields === 'string') {
    result = [fields];
  } else if (Array.isArray(fields) && fields.length > 0) {
    // No empty array, including all the fields
    result = fields;
  } else if ('object' === typeof fields) {
    // { field1: boolean, field2: boolean ... }
    var included = [];
    var excluded = [];
    var keys = Object.keys(fields);
    if (!keys.length) return;

    for (i = 0, n = keys.length; i < n; i++) {
      var k = keys[i];
      if (fields[k]) {
        included.push(k);
      } else if ((k in fields) && !fields[k]) {
        excluded.push(k);
      }
    }
    if (included.length > 0) {
      result = included;
    } else if (excluded.length > 0) {
      for (i = 0, n = excluded.length; i < n; i++) {
        var index = result.indexOf(excluded[i]);
        if (index !== -1) result.splice(index, 1); // only when existing field excluded
      }
    }
  }

  var fieldArray = [];
  if (excludeUnknown) {
    for (i = 0, n = result.length; i < n; i++) {
      if (properties.indexOf(result[i]) !== -1) {
        fieldArray.push(result[i]);
      }
    }
  } else {
    fieldArray = result;
  }
  return fieldArray;
}

function selectFields(fields) {
  // map function
  return function(obj) {
    var result = {};
    var key;

    for (var i = 0; i < fields.length; i++) {
      key = fields[i];

      result[key] = obj[key];
    }
    return result;
  };
}

/**
 * Remove undefined values from the queury object
 * @param query
 * @param handleUndefined {String} either "nullify", "throw" or "ignore" (default: "ignore")
 * @returns {exports.map|*}
 */
function removeUndefined(query, handleUndefined) {
  if (typeof query !== 'object' || query === null) {
    return query;
  }
  // WARNING: [rfeng] Use map() will cause mongodb to produce invalid BSON
  // as traverse doesn't transform the ObjectId correctly
  return traverse(query).forEach(function(x) {
    if (x === undefined) {
      switch (handleUndefined) {
        case 'nullify':
          this.update(null);
          break;
        case 'throw':
          throw new Error(g.f('Unexpected `undefined` in query'));
          break;
        case 'ignore':
        default:
          this.remove();
      }
    }

    if (!Array.isArray(x) && (typeof x === 'object' && x !== null &&
        x.constructor !== Object)) {
      // This object is not a plain object
      this.update(x, true); // Stop navigating into this object
      return x;
    }

    return x;
  });
}

var url = require('url');
var qs = require('qs');

/**
 * Parse a URL into a settings object
 * @param {String} urlStr The URL for connector settings
 * @returns {Object} The settings object
 */
function parseSettings(urlStr) {
  if (!urlStr) {
    return {};
  }
  var uri = url.parse(urlStr, false);
  var settings = {};
  settings.connector = uri.protocol && uri.protocol.split(':')[0]; // Remove the trailing :
  settings.host = settings.hostname = uri.hostname;
  settings.port = uri.port && Number(uri.port); // port is a string
  settings.user = settings.username = uri.auth && uri.auth.split(':')[0]; // <username>:<password>
  settings.password = uri.auth && uri.auth.split(':')[1];
  settings.database = uri.pathname && uri.pathname.split('/')[1]; // remove the leading /
  settings.url = urlStr;
  if (uri.query) {
    var params = qs.parse(uri.query);
    for (var p in params) {
      settings[p] = params[p];
    }
  }
  return settings;
}

/**
 * Objects deep merge
 *
 * Forked from https://github.com/nrf110/deepmerge/blob/master/index.js
 *
 * The original function tries to merge array items if they are objects, this
 * was changed to always push new items in arrays, independently of their type.
 *
 * NOTE: The function operates as a deep clone when called with a single object
 * argument.
 *
 * @param {Object} base The base object
 * @param {Object} extras The object to merge with base
 * @returns {Object} The merged object
 */
function deepMerge(base, extras) {
  // deepMerge allows undefined extras to allow deep cloning of arrays
  var array = Array.isArray(base) && (Array.isArray(extras) || !extras);
  var dst = array && [] || {};

  if (array) {
    // extras or base is an array
    extras = extras || [];
    // Add items from base into dst
    dst = dst.concat(base);
    // Add non-existent items from extras into dst
    extras.forEach(function(e) {
      if (dst.indexOf(e) === -1) {
        dst.push(e);
      }
    });
  } else {
    if (base != null && typeof base === 'object') {
      // Add properties from base to dst
      Object.keys(base).forEach(function(key) {
        if (base[key] && typeof base[key] === 'object') {
          // call deepMerge on nested object to operate a deep clone
          dst[key] = deepMerge(base[key]);
        } else {
          dst[key] = base[key];
        }
      });
    }
    if (extras != null && typeof extras === 'object') {
      // extras is an object {}
      Object.keys(extras).forEach(function(key) {
        var extra = extras[key];
        if (extra == null || typeof extra !== 'object') {
          // extra item value is null, undefined or not an object
          dst[key] = extra;
        } else {
          // The extra item value is an object
          if (base == null || typeof base !== 'object' ||
            base[key] == null) {
            // base is not an object or base item value is undefined or null
            dst[key] = extra;
          } else {
            // call deepMerge on nested object
            dst[key] = deepMerge(base[key], extra);
          }
        }
      });
    }
  }

  return dst;
}

/**
 * Properties deep merge
 * Similar as deepMerge but also works on single properties of any type
 *
 * @param {Object} base The base property
 * @param {Object} extras The property to merge with base
 * @returns {Object} The merged property
 */
function deepMergeProperty(base, extras) {
  let mergedObject = deepMerge({key: base}, {key: extras});
  let mergedProperty = mergedObject.key;
  return mergedProperty;
}

const numberIsFinite = Number.isFinite || function(value) {
  return typeof value === 'number' && isFinite(value);
};

/**
 * Adds a property __rank to array elements of type object {}
 * If an inner element already has the __rank property it is not altered
 * NOTE: the function mutates the provided array
 *
 * @param array The original array
 * @param rank The rank to apply to array elements
 * @return rankedArray The original array with newly ranked elements
 */
function rankArrayElements(array, rank) {
  if (!Array.isArray(array) || !numberIsFinite(rank))
    return array;

  array.forEach(function(el) {
    // only apply ranking on objects {} in array
    if (!el || typeof el != 'object' || Array.isArray(el))
      return;

    // property rank is already defined for array element
    if (el.__rank)
      return;

    // define rank property as non-enumerable and read-only
    Object.defineProperty(el, '__rank', {
      writable: false,
      enumerable: false,
      configurable: false,
      value: rank,
    });
  });
  return array;
}

/**
 * Define an non-enumerable __cachedRelations property
 * @param {Object} obj The obj to receive the __cachedRelations
 */
function defineCachedRelations(obj) {
  if (!obj.__cachedRelations) {
    Object.defineProperty(obj, '__cachedRelations', {
      writable: true,
      enumerable: false,
      configurable: true,
      value: {},
    });
  }
}

/**
 * Check if the argument is plain object
 * @param {*) obj The obj value
 * @returns {boolean}
 */
function isPlainObject(obj) {
  return (typeof obj === 'object') && (obj !== null) &&
    (obj.constructor === Object);
}

function sortObjectsByIds(idName, ids, objects, strict) {
  ids = ids.map(function(id) {
    return (typeof id === 'object') ? String(id) : id;
  });

  var indexOf = function(x) {
    var isObj = (typeof x[idName] === 'object'); // ObjectID
    var id = isObj ? String(x[idName]) : x[idName];
    return ids.indexOf(id);
  };

  var heading = [];
  var tailing = [];

  objects.forEach(function(x) {
    if (typeof x === 'object') {
      var idx = indexOf(x);
      if (strict && idx === -1) return;
      idx === -1 ? tailing.push(x) : heading.push(x);
    }
  });

  heading.sort(function(x, y) {
    var a = indexOf(x);
    var b = indexOf(y);
    if (a === -1 || b === -1) return 1; // last
    if (a === b) return 0;
    if (a > b) return 1;
    if (a < b) return -1;
  });

  return heading.concat(tailing);
};

function createPromiseCallback() {
  var cb;
  var promise = new Promise(function(resolve, reject) {
    cb = function(err, data) {
      if (err) return reject(err);
      return resolve(data);
    };
  });
  cb.promise = promise;
  return cb;
}

/**
 * Dedupe an array
 * @param {Array} an array
 * @returns {Array} an array with unique items
 */
function uniq(a) {
  var uniqArray = [];
  if (!a) {
    return uniqArray;
  }
  assert(Array.isArray(a), 'array argument is required');
  var comparableA = a.map(
    item => item.hasOwnProperty('_bsontype') ? item.toString() : item
  );
  for (var i = 0, n = comparableA.length; i < n; i++) {
    if (comparableA.indexOf(comparableA[i]) === i) {
      uniqArray.push(a[i]);
    }
  }
  return uniqArray;
}

/**
 * Converts a string, regex literal, or a RegExp object to a RegExp object.
 * @param {String|Object} The string, regex literal, or RegExp object to convert
 * @returns {Object} A RegExp object
 */
function toRegExp(regex) {
  var isString = typeof regex === 'string';
  var isRegExp = regex instanceof RegExp;

  if (!(isString || isRegExp))
    return new Error(g.f('Invalid argument, must be a string, {{regex}} literal, or ' +
        '{{RegExp}} object'));

  if (isRegExp)
    return regex;

  if (!hasRegExpFlags(regex))
    return new RegExp(regex);

  // only accept i, g, or m as valid regex flags
  var flags = regex.split('/').pop().split('');
  var validFlags = ['i', 'g', 'm'];
  var invalidFlags = [];
  flags.forEach(function(flag) {
    if (validFlags.indexOf(flag) === -1)
      invalidFlags.push(flag);
  });

  var hasInvalidFlags = invalidFlags.length > 0;
  if (hasInvalidFlags)
    return new Error(g.f('Invalid {{regex}} flags: %s', invalidFlags));

  // strip regex delimiter forward slashes
  var expression = regex.substr(1, regex.lastIndexOf('/') - 1);
  return new RegExp(expression, flags.join(''));
}

function hasRegExpFlags(regex) {
  return regex instanceof RegExp ?
    regex.toString().split('/').pop() :
    !!regex.match(/.*\/.+$/);
}

// Compare two id values to decide if updateAttributes is trying to change
// the id value for a given instance
function idEquals(id1, id2) {
  if (id1 === id2) {
    return true;
  }
  // Allows number/string conversions
  if ((typeof id1 === 'number' && typeof id2 === 'string') ||
    (typeof id1 === 'string' && typeof id2 === 'number')) {
    return id1 == id2;
  }
  // For complex id types such as MongoDB ObjectID
  id1 = JSON.stringify(id1);
  id2 = JSON.stringify(id2);
  if (id1 === id2) {
    return true;
  }

  return false;
}

// Defaults to native Array.prototype.indexOf when no idEqual is present
// Otherwise, returns the lowest index for which isEqual(arr[]index, target) is true
function findIndexOf(arr, target, isEqual) {
  if (!isEqual) {
    return arr.indexOf(target);
  }

  for (var i = 0; i < arr.length; i++) {
    if (isEqual(arr[i], target)) { return i; }
  };

  return -1;
}

/**
 * Returns an object that queries targetIds.
 * @param {Array} The array of targetData
 * @param {String} The Id property name of target model
 * @returns {Object} The object that queries targetIds
 */
function collectTargetIds(targetData, idPropertyName) {
  var targetIds = [];
  for (var i = 0; i < targetData.length; i++) {
    var targetId = targetData[i][idPropertyName];
    targetIds.push(targetId);
  };
  var IdQuery = {
    inq: uniq(targetIds),
  };
  return IdQuery;
}

/**
 * Find the idKey of a Model.
 * @param {ModelConstructor} m - Model Constructor
 * @returns {String}
 */
function idName(m) {
  return m.definition.idName() || 'id';
}

/**
 * Check a list of IDs to see if there are any duplicates.
 *
 * @param {Array} The array of IDs to check
 * @returns {boolean} If any duplicates were found
 */
function idsHaveDuplicates(ids) {
  // use Set if available and all ids are of string or number type
  var hasDuplicates = undefined;
  var i, j;
  if (typeof Set === 'function') {
    var uniqueIds = new Set();
    for (i = 0; i < ids.length; ++i) {
      var idType = typeof ids[i];
      if (idType === 'string' || idType === 'number') {
        if (uniqueIds.has(ids[i])) {
          hasDuplicates = true;
          break;
        } else {
          uniqueIds.add(ids[i]);
        }
      } else {
        // ids are not all string/number that can be checked via Set, stop and do the slow test
        break;
      }
    }
    if (hasDuplicates === undefined && uniqueIds.size === ids.length) {
      hasDuplicates = false;
    }
  }
  if (hasDuplicates === undefined) {
    // fast check was inconclusive or unavailable, do the slow check
    // can still optimize this by doing 1/2 N^2 instead of the full N^2
    for (i = 0; i < ids.length && hasDuplicates === undefined; ++i) {
      for (j = 0; j < i; ++j) {
        if (idEquals(ids[i], ids[j])) {
          hasDuplicates = true;
          break;
        }
      }
    }
  }
  return hasDuplicates === true;
}
