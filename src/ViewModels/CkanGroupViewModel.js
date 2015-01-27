'use strict';

/*global require,URI,$*/

var clone = require('../../third_party/cesium/Source/Core/clone');
var defined = require('../../third_party/cesium/Source/Core/defined');
var defineProperties = require('../../third_party/cesium/Source/Core/defineProperties');
var freezeObject = require('../../third_party/cesium/Source/Core/freezeObject');
var knockout = require('../../third_party/cesium/Source/ThirdParty/knockout');
var loadJson = require('../../third_party/cesium/Source/Core/loadJson');
var loadText = require('../../third_party/cesium/Source/Core/loadText');
var Rectangle = require('../../third_party/cesium/Source/Core/Rectangle');
var when = require('../../third_party/cesium/Source/ThirdParty/when');

var corsProxy = require('../Core/corsProxy');
var ViewModelError = require('./ViewModelError');
var CatalogGroupViewModel = require('./CatalogGroupViewModel');
var inherit = require('../Core/inherit');
var WebMapServiceItemViewModel = require('./WebMapServiceItemViewModel');
var ArcGisMapServerItemViewModel = require('./ArcGisMapServerItemViewModel');

/**
 * A {@link CatalogGroupViewModel} representing a collection of layers from a [CKAN](http://ckan.org) server.
 *
 * @alias CkanGroupViewModel
 * @constructor
 * @extends CatalogGroupViewModel
 * 
 * @param {ApplicationViewModel} application The application.
 */
var CkanGroupViewModel = function(application) {
    CatalogGroupViewModel.call(this, application, 'ckan');

    /**
     * Gets or sets the URL of the CKAN server.  This property is observable.
     * @type {String}
     */
    this.url = '';

    /**
     * Gets or sets a description of the custodian of the data sources in this group.
     * This property is an HTML string that must be sanitized before display to the user.
     * This property is observable.
     * @type {String}
     */
    this.dataCustodian = undefined;

    /**
     * Gets or sets the filter query to pass to CKAN when querying the available data sources and their groups.  Each string in the 
     * array is passed to CKAN as an independent search string and the results are concatenated to create the complete list.  The
     * search string is equivlent to what would be in the parameters segment of the url calling the CKAN search api.
     * See the [Solr documentation](http://wiki.apache.org/solr/CommonQueryParameters#fq) for information about filter queries.
     *   To get all the datasets with wms resources the query array would be ['fq=res_format%3awms']
     *   To get all the datasets in the Surface Water group it would be ['q=groups%3dSurface%20Water&fq=res_format%3aWMS']
     *   And to get both wms and esri-mapService datasets it would be ['q=res_format:WMS', 'q=res_format:%22Esri%20REST%22' ]
     * This property is observable.
     * @type {String[]}
     */
    this.filterQuery = undefined;

    /**
     * Gets or sets a hash of names of blacklisted groups and data sources.  A group or data source that appears in this hash
     * will not be shown to the user.  In this hash, the keys should be the names of the groups and data sources to blacklist,
     * and the values should be "true".  This property is observable.
     * @type {Object}
     */
    this.blacklist = undefined;

    /**
     * Gets or sets a value indicating whether the CKAN datasets should be filtered by querying GetCapabilities from each
     * referenced WMS server and excluding datasets not found therein.  This property is observable.
     * @type {Boolean}
     */
    this.filterByWmsGetCapabilities = false;

    /**
     * Gets or sets the minimum MaxScaleDenominator that is allowed for a WMS dataset to be included in this CKAN group.
     * If this property is undefined or if {@link CkanGroupViewModel#filterByWmsGetCapabilities} is false, no
     * filtering based on MaxScaleDenominator is performed.  This property is observable.
     * @type {Number}
     */
    this.minimumMaxScaleDenominator = undefined;

    /**
     * Gets or sets any extra wms parameters that should be added to the wms query urls in this CKAN group.
     * If this property is undefined or if {@link CkanGroupViewModel#wmsParameters} then no extra 
     * parameters are added.
     * This property is observable.
     * @type {Object}
     */
    this.wmsParameters = undefined;

    knockout.track(this, ['url', 'dataCustodian', 'filterQuery', 'blacklist', 'wmsParameters']);
};

inherit(CatalogGroupViewModel, CkanGroupViewModel);

defineProperties(CkanGroupViewModel.prototype, {
    /**
     * Gets the type of data member represented by this instance.
     * @memberOf CkanGroupViewModel.prototype
     * @type {String}
     */
    type : {
        get : function() {
            return 'ckan';
        }
    },

    /**
     * Gets a human-readable name for this type of data source, such as 'Web Map Service (WMS)'.
     * @memberOf CkanGroupViewModel.prototype
     * @type {String}
     */
    typeName : {
        get : function() {
            return 'CKAN Group';
        }
    },

    /**
     * Gets the set of functions used to serialize individual properties in {@link CatalogMemberViewModel#serializeToJson}.
     * When a property name on the view-model matches the name of a property in the serializers object lieral,
     * the value will be called as a function and passed a reference to the view-model, a reference to the destination
     * JSON object literal, and the name of the property.
     * @memberOf CkanGroupViewModel.prototype
     * @type {Object}
     */
    serializers : {
        get : function() {
            return CkanGroupViewModel.defaultSerializers;
        }
    }
});

/**
 * Gets or sets the set of default serializer functions to use in {@link CatalogMemberViewModel#serializeToJson}.  Types derived from this type
 * should expose this instance - cloned and modified if necesary - through their {@link CatalogMemberViewModel#serializers} property.
 * @type {Object}
 */
CkanGroupViewModel.defaultSerializers = clone(CatalogGroupViewModel.defaultSerializers);

CkanGroupViewModel.defaultSerializers.items = function(viewModel, json, propertyName, options) {
    // Only serialize minimal properties in contained items, because other properties are loaded from CKAN.
    var previousSerializeForSharing = options.serializeForSharing;
    options.serializeForSharing = true;

    // Only serlize enabled items as well.  This isn't quite right - ideally we'd serialize any
    // property of any item if the property's value is changed from what was loaded from CKAN -
    // but this gives us reasonable results for sharing and is a lot less work than the ideal
    // solution.
    var previousEnabledItemsOnly = options.enabledItemsOnly;
    options.enabledItemsOnly = true;

    var result = CatalogGroupViewModel.defaultSerializers.items(viewModel, json, propertyName, options);

    options.enabledItemsOnly = previousEnabledItemsOnly;
    options.serializeForSharing = previousSerializeForSharing;

    return result;
};

CkanGroupViewModel.defaultSerializers.isLoading = function(viewModel, json, propertyName, options) {};

freezeObject(CkanGroupViewModel.defaultSerializers);

CkanGroupViewModel.prototype._getValuesThatInfluenceLoad = function() {
    return [this.url, this.filterQuery, this.blacklist, this.filterByWmsGetCapabilities, this.minimumMaxScaleDenominator];
};

CkanGroupViewModel.prototype._load = function() {
    if (!defined(this.url) || this.url.length === 0) {
        return undefined;
    }

    var that = this;

    var handleError = function() {
            throw new ViewModelError({
                sender: that,
                title: 'Group is not available',
                message: '\
    An error occurred while invoking package_search on the CKAN server.  \
    <p>If you entered the link manually, please verify that the link is correct.</p>\
    <p>This error may also indicate that the server does not support <a href="http://enable-cors.org/" target="_blank">CORS</a>.  If this is your \
    server, verify that CORS is enabled and enable it if it is not.  If you do not control the server, \
    please contact the administrator of the server and ask them to enable CORS.  Or, contact the National \
    Map team by emailing <a href="mailto:nationalmap@lists.nicta.com.au">nationalmap@lists.nicta.com.au</a> \
    and ask us to add this server to the list of non-CORS-supporting servers that may be proxied by \
    National Map itself.</p>\
    <p>If you did not enter this link manually, this error may indicate that the group you opened is temporarily unavailable or there is a \
    problem with your internet connection.  Try opening the group again, and if the problem persists, please report it by \
    sending an email to <a href="mailto:nationalmap@lists.nicta.com.au">nationalmap@lists.nicta.com.au</a>.</p>'
        });
    };

    var promises = [];
    for (var i = 0; i < this.filterQuery.length; i++) {
        var url = cleanAndProxyUrl(this.application, this.url) + '/api/3/action/package_search?rows=100000&' + this.filterQuery[i];

        var promise = loadJson(url).otherwise(handleError);

        promises.push(promise);
    }

    return when.all(promises).then( function(queryResults) {
        if (!defined(queryResults)) {
            return;
        }
        var allResults = queryResults[0];
        for (var p = 1; p < queryResults.length; p++) {
            allResults.result.results = allResults.result.results.concat(queryResults[p].result.results);
        }

        if (that.filterByWmsGetCapabilities) {
            return when(filterResultsByGetCapabilities(that, allResults), function() {
                populateGroupFromResults(that, allResults);
            });
        } else {
            populateGroupFromResults(that, allResults);
        }
    });
};

// The "format" field of CKAN resources must match this regular expression to be considered a WMS resource.
var wmsFormatRegex = /^wms$/i;
var esriRestFormatRegex = /^esri rest$/i;

function filterResultsByGetCapabilities(viewModel, json) {
    var wmsServers = {};

    var items = json.result.results;
    for (var itemIndex = 0; itemIndex < items.length; ++itemIndex) {
        var item = items[itemIndex];

        var resources = item.resources;
        for (var resourceIndex = 0; resourceIndex < resources.length; ++resourceIndex) {
            var resource = resources[resourceIndex];
            if (!resource.format.match(wmsFormatRegex)) {
                continue;
            }

            var wmsUrl = resource.wms_url;
            if (!defined(wmsUrl)) {
                wmsUrl = resource.url;
                if (!defined(wmsUrl)) {
                    continue;
                }
            }

            // Extract the layer name from the WMS URL.
            var uri = new URI(wmsUrl);
            var params = uri.search(true);
            var layerName = params.LAYERS;

            // Remove the query portion of the WMS URL.
            uri.search('');
            var url = uri.toString();

            if (!defined(wmsServers[url])) {
                wmsServers[url] = {};
            }

            wmsServers[url][layerName] = resource;
        }
    }

    var promises = [];

    for (var wmsServer in wmsServers) {
        if (wmsServers.hasOwnProperty(wmsServer)) {
            var getCapabilitiesUrl = wmsServer + '?service=WMS&request=GetCapabilities';
            if (corsProxy.shouldUseProxy(getCapabilitiesUrl)) {
                getCapabilitiesUrl = corsProxy.getURL(getCapabilitiesUrl, '1d');
            }

            promises.push(filterBasedOnGetCapabilities(viewModel, getCapabilitiesUrl, wmsServers[wmsServer]));
        }
    }

    return when.all(promises);
}

function filterBasedOnGetCapabilities(viewModel, getCapabilitiesUrl, resources) {
    // Initially assume all resources will be filtered.
    for (var name in resources) {
        if (resources.hasOwnProperty(name)) {
            resources[name].__filtered = true;
        }
    }

    return loadText(getCapabilitiesUrl).then(function(getCapabilitiesXml) {
        var getCapabilitiesJson = $.xml2json(getCapabilitiesXml);
        filterBasedOnGetCapabilitiesResponse(viewModel, getCapabilitiesJson.Capability.Layer, resources);
    }).otherwise(function() {
        // Do nothing - all resources will be filtered.
    });
}

function filterBasedOnGetCapabilitiesResponse(viewModel, wmsLayersSource, resources) {
    if (defined(wmsLayersSource) && !(wmsLayersSource instanceof Array)) {
        wmsLayersSource = [wmsLayersSource];
    }

    for (var i = 0; i < wmsLayersSource.length; ++i) {
        var layerSource = wmsLayersSource[i];

        if (layerSource.Name) {
            var resource = resources[layerSource.Name];
            if (resource) {
                if (!defined(viewModel.minimumMaxScaleDenominator) || !defined(layerSource.MaxScaleDenominator) || layerSource.MaxScaleDenominator >= viewModel.minimumMaxScaleDenominator) {
                    resource.__filtered = false;
                }
                else {
                    console.log('Provider Feedback: Filtering out ' + layerSource.Title + ' (' + layerSource.Name + ') because its MaxScaleDenominator is ' + layerSource.MaxScaleDenominator);
                }
            }
        }

        if (layerSource.Layer) {
            filterBasedOnGetCapabilitiesResponse(viewModel, layerSource.Layer, resources);
        }
    }
}

function populateGroupFromResults(viewModel, json) {
    var items = json.result.results;
    for (var itemIndex = 0; itemIndex < items.length; ++itemIndex) {
        var item = items[itemIndex];

        if (viewModel.blacklist && viewModel.blacklist[item.title]) {
            console.log('Provider Feedback: Filtering out ' + item.title + ' (' + item.name + ') because it is blacklisted.');
            continue;
        }

        var textDescription = '';

        if (item.notes) {
            textDescription = item.notes.replace(/\n/g, '<br/>');
        }

        if (item.license_url && (item.notes === null || item.notes.indexOf('[Licence]') === -1)) {
            textDescription += '<br/>[Licence](' + item.license_url + ')';
        }

        var extras = {};
        if (defined(item.extras)) {
            for (var idx = 0; idx < item.extras.length; idx++) {
                extras[item.extras[idx].key] = item.extras[idx].value;
            }
        }

        var dataUrl = extras.data_url;
        var dataUrlType = extras.data_url_type;

        var rectangle;
        var bboxString = item.geo_coverage || extras.geo_coverage;
        if (defined(bboxString)) {
            var parts = bboxString.split(',');
            if (parts.length === 4) {
                rectangle = Rectangle.fromDegrees(parts[0], parts[1], parts[2], parts[3]);
            }
        }

        // Currently, we support WMS and Esri REST layers.
        var resources = item.resources;
        for (var resourceIndex = 0; resourceIndex < resources.length; ++resourceIndex) {
            var resource = resources[resourceIndex];
            if (resource.__filtered || (!resource.format.match(wmsFormatRegex) && !resource.format.match(esriRestFormatRegex))) {
                continue;
            }

            var wmsUrl = resource.wms_url;
            if (!defined(wmsUrl)) {
                wmsUrl = resource.url;
                if (!defined(wmsUrl)) {
                    continue;
                }
            }

            // Extract the layer name from the WMS URL.
            var uri = new URI(wmsUrl);
            var params = uri.search(true);
            var layerName = params.LAYERS || params.layers;

            // Remove the query portion of the WMS URL.
            uri.search('');
            var url = uri.toString();

            var newItem;
            if (resource.format.match(esriRestFormatRegex)) {
                newItem = new ArcGisMapServerItemViewModel(viewModel.application);
            } else {
                newItem = new WebMapServiceItemViewModel(viewModel.application);
            }
            newItem.name = item.title;
            newItem.description = textDescription;
            newItem.url = url;
            newItem.layers = layerName;
            newItem.rectangle = rectangle;
            newItem.dataUrl = dataUrl;
            newItem.dataUrlType = dataUrlType;
              //This should be deprecated and done on a server by server basis when feasible
            newItem.parameters = viewModel.wmsParameters;

            if (defined(viewModel.dataCustodian)) {
                newItem.dataCustodian = viewModel.dataCustodian;
            } else if (item.organization && item.organization.title) {
                newItem.dataCustodian = item.organization.description || item.organization.title;
            }

            var groups = item.groups;
            for (var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
                var group = groups[groupIndex];

                if (viewModel.blacklist && viewModel.blacklist[group.display_name]) {
                    continue;
                }

                var existingGroup = viewModel.findFirstItemByName(group.display_name);
                if (!defined(existingGroup)) {
                    existingGroup = new CatalogGroupViewModel(viewModel.application);
                    existingGroup.name = group.display_name;
                    viewModel.add(existingGroup);
                }

                existingGroup.add(newItem);
            }
        }
    }

    function compareNames(a, b) {
        var aName = a.name.toLowerCase();
        var bName = b.name.toLowerCase();
        if (aName < bName) {
            return -1;
        } else if (aName > bName) {
            return 1;
        } else {
            return 0;
        }
    }

    viewModel.items.sort(compareNames);

    for (var i = 0; i < viewModel.items.length; ++i) {
        viewModel.items[i].items.sort(compareNames);
    }
}

function cleanAndProxyUrl(application, url) {
    // Strip off the search portion of the URL
    var uri = new URI(url);
    uri.search('');

    var cleanedUrl = uri.toString();
    if (defined(application.corsProxy) && application.corsProxy.shouldUseProxy(cleanedUrl)) {
        cleanedUrl = application.corsProxy.getURL(cleanedUrl, '1d');
    }

    return cleanedUrl;
}

module.exports = CkanGroupViewModel;
