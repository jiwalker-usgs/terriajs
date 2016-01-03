/*global require*/
"use strict";

var defined = require('terriajs-cesium/Source/Core/defined');
var defineProperties = require('terriajs-cesium/Source/Core/defineProperties');
var destroyObject = require('terriajs-cesium/Source/Core/destroyObject');

var csv = require('../ThirdParty/csv');
var TableColumn = require('./TableColumn');

/**
 * TableStructure provides an abstraction of a data table, ie. a structure with rows and columns.
 * Its primary responsibility is to load and parse the data, from csvs or other.
 * It stores each column as a TableColumn.
 * These are also sorted by type for easier access.
 *
 * @alias TableStructure
 * @constructor
 */
var TableStructure = function() {
    this.columns = [];
    this._columnsByType = undefined;
    this._rows = undefined;  // Store a copy by rows too, to simplify row-based operations.
};

defineProperties(TableStructure.prototype, {
    /**
     * Gets the columnsByType for this structure,
     * an object whose keys are VarTypes, and whose values are arrays of TableColumn with matching type.
     * Only existing types are present (eg. columnsByType[VarType.ALT] may be undefined).
     * @memberOf TableStructure.prototype
     * @type {Object}
     */
    columnsByType : {
        get : function() {
            return this._columnsByType;
        }
    }
});

/**
* Create a TableStructure from a JSON object, eg. [['x', 'y'], [1, 5], [3, 8], [4, -3]].
*
* @param {Object} json Table data in JSON format
* @param {TableStructure} [result] A pre-existing TableStructure object; if not present, creates a new one.
*/
TableStructure.fromJson = function(json, result) {
    if (!defined(json) || json.length === 0 || json[0].length === 0) {
        return;
    }
    if (!defined(result)) {
        result = new TableStructure();
    }
    result._rows = json;
    var columnNames = json[0];
    var rowNumber, name, values;
    for (var columnNumber = 0; columnNumber < columnNames.length; columnNumber++) {
        name = columnNames[columnNumber] ? columnNames[columnNumber].trim() : "_Column" + String(columnNumber);
        values = [];
        for (rowNumber = 1; rowNumber < json.length; rowNumber++) {
            values.push(json[rowNumber][columnNumber]);
        }
        result.columns.push(new TableColumn(name, values));
    }
    setColumnsByType(result);
    return result;
};

/**
* Create a TableStructure from a string in csv format.
* Understands \r\n, \r and \n as newlines.
*
* @param {String} csvString String in csv format.
* @param {TableStructure} [result] A pre-existing TableStructure object; if not present, creates a new one.
*/
TableStructure.fromCsv = function(csvString, result) {

    // Originally from jquery-csv plugin. Modified to avoid stripping leading zeros.
    function castToScalar(value, state) {
        var hasDot = /\./;
        var leadingZero = /^0[0-9]/;
        var numberWithThousands = /^[1-9]\d?\d?(,\d\d\d)+(\.\d+)?$/;
        if (numberWithThousands.test(value)) {
            value = value.replace(/,/g, '');
        }
        if (isNaN(value)) {
            return value;
        }
        if (leadingZero.test(value)) {
            return value;
        }
        if (hasDot.test(value)) {
          return parseFloat(value);
        }
        var integer = parseInt(value);
        if (isNaN(integer)) {
            return null;
        }
        return integer;
    }

    //normalize line breaks
    csvString = csvString.replace(/\r\n|\r|\n/g, "\r\n");
    // Handle CSVs missing a final linefeed
    if (csvString[csvString.length - 1] !== '\n') {
        csvString += '\r\n';
    }
    var json = csv.toArrays(csvString, {
        onParseValue: castToScalar
    });
    return TableStructure.fromJson(json, result);
};

/**
* Return data as an array of columns, eg. [ ['x', 1, 2, 3], ['y', 10, 20, 5] ].
* @returns {Object} An array of column arrays, each beginning with the column name.
*/
TableStructure.prototype.toArrayOfColumns = function() {
    var result = [];
    var column;
    for (var i = 0; i < this.columns.length; i++) {
        column = this.columns[i];
        result.push(column.toArrayWithName());
    }
    return result;
};

/**
* Return data as an array of rows, eg. [ ['x', 'y'], [1, 10], [2, 20], [3, 5] ].
* @returns {Object} An array of rows, the first of which is the column names.
*/
TableStructure.prototype.toArrayOfRows = function() {
    return this._rows;
};

/**
* Return data as a string in csv format, with newlines represented by \n.
* @returns {String} csv formatted version of the data.
*/
TableStructure.prototype.toCsvString = function() {
    var table = this.getJsonTable();
    //Serialize the arrays
    var joinedRows = table.map(function(arr) {
        return arr.join(',');
    });
    var tableText = joinedRows.join('\n');
    return tableText;
};

/**
* Return data as an array of rows of objects, eg. [{'x': 1, 'y': 10}, {'x': 2, 'y': 20}, ...].
* Note this won't work if a column name is a javascript reserved word.
*
* @returns {Object[]} Array of objects containing a property for each column of the row.
*/
TableStructure.prototype.toRowObjects = function() {
    var asRows = this.toArrayOfRows();
    var columnNames = asRows[0];
    var result = [];
    for (var i = 1; i < asRows.length; i++) {
        var rowObject = {};
        for (var j = 0; j < columnNames.length; j++) {
            rowObject[columnNames[j]] = asRows[i][j];
        }
        result.push(rowObject);
    }
    return result;
};

/**
* Get the column names.
*
* @returns {String[]} Array of column names.
*/
TableStructure.prototype.getColumnNames = function() {
    var result = [];
    for (var i = 0; i < this.columns.length; i++) {
        result.push(this.columns[i].name);
    }
    return result;
};

/**
 * Destroy the object and release resources.
 */
TableStructure.prototype.destroy = function() {
    return destroyObject(this);
};

/**
 * Sets columnsByType to an object whose keys are elements of VarType,
 * and whose values are arrays of TableColumn objects of that type.
 * Only existing types are present (eg. structure.columnsByType[VarType.ALT] may be undefined).
 */
function setColumnsByType(structure) {
    structure._columnsByType = {};
    for (var i = 0; i < structure.columns.length; i++) {
        var column = structure.columns[i];
        var columnsOfThisType = structure._columnsByType[column.type];
        if (defined(columnsOfThisType)) {
            columnsOfThisType.push(column);
        } else {
            columnsOfThisType = [column];
        }
    }
}

module.exports = TableStructure;
