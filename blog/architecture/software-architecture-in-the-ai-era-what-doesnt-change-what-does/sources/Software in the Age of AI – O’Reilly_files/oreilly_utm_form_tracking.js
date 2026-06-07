/***************************************************************************
 *
 * This script retrieves UTM query string values, if present, 
 * and saves them in a cookie. If a lead generation form is present, the script will 
 * add hidden fields to it and populate them with the UTM values stored in 
 * the cookie if any exist.
 *
 ***************************************************************************/

/* UTM FIELDS: */

var oreillyUTM_fields = {
  'utm_medium' : 'utm_medium',
  'utm_source' : 'utm_source',
  'utm_campaign' : 'utm_campaign',
  'utm_content' : 'utm_content'
};


/*********************** DO NOT EDIT BELOW THIS LINE ************************/


/*!
 * JavaScript Cookie v2.1.3
 * https://github.com/js-cookie/js-cookie
 *
 * Copyright 2006, 2015 Klaus Hartl & Fagner Brack
 * Released under the MIT license
 */
;(function (factory) {
  var registeredInModuleLoader = false;
  if (typeof define === 'function' && define.amd) {
    define(factory);
    registeredInModuleLoader = true;
  }
  if (typeof exports === 'object') {
    module.exports = factory();
    registeredInModuleLoader = true;
  }
  if (!registeredInModuleLoader) {
    var OldCookies = window.Cookies;
    var api = window.Cookies = factory();
    api.noConflict = function () {
      window.Cookies = OldCookies;
      return api;
    };
  }
}(function () {
  function extend () {
    var i = 0;
    var result = {};
    for (; i < arguments.length; i++) {
      var attributes = arguments[ i ];
      for (var key in attributes) {
        result[key] = attributes[key];
      }
    }
    return result;
  }

  function init (converter) {
    function api (key, value, attributes) {
      var result;
      if (typeof document === 'undefined') {
        return;
      }

      // Write

      if (arguments.length > 1) {
        attributes = extend({
          path: '/'
        }, api.defaults, attributes);

        if (typeof attributes.expires === 'number') {
          var expires = new Date();
          expires.setMilliseconds(expires.getMilliseconds() + attributes.expires * 864e+5);
          attributes.expires = expires;
        }

        try {
          result = JSON.stringify(value);
          if (/^[\{\[]/.test(result)) {
            value = result;
          }
        } catch (e) {}

        if (!converter.write) {
          value = encodeURIComponent(String(value))
            .replace(/%(23|24|26|2B|3A|3C|3E|3D|2F|3F|40|5B|5D|5E|60|7B|7D|7C)/g, decodeURIComponent);
        } else {
          value = converter.write(value, key);
        }

        key = encodeURIComponent(String(key));
        key = key.replace(/%(23|24|26|2B|5E|60|7C)/g, decodeURIComponent);
        key = key.replace(/[\(\)]/g, escape);

        return (document.cookie = [
          key, '=', value,
          attributes.expires ? '; expires=' + attributes.expires.toUTCString() : '', // use expires attribute, max-age is not supported by IE
          attributes.path ? '; path=' + attributes.path : '',
          attributes.domain ? '; domain=' + attributes.domain : '',
          attributes.secure ? '; secure' : ''
        ].join(''));
      }

      // Read

      if (!key) {
        result = {};
      }

      // To prevent the for loop in the first place assign an empty array
      // in case there are no cookies at all. Also prevents odd result when
      // calling "get()"
      var cookies = document.cookie ? document.cookie.split('; ') : [];
      var rdecode = /(%[0-9A-Z]{2})+/g;
      var i = 0;

      for (; i < cookies.length; i++) {
        var parts = cookies[i].split('=');
        var cookie = parts.slice(1).join('=');

        if (cookie.charAt(0) === '"') {
          cookie = cookie.slice(1, -1);
        }

        try {
          var name = parts[0].replace(rdecode, decodeURIComponent);
          cookie = converter.read ?
            converter.read(cookie, name) : converter(cookie, name) ||
            cookie.replace(rdecode, decodeURIComponent);

          if (this.json) {
            try {
              cookie = JSON.parse(cookie);
            } catch (e) {}
          }

          if (key === name) {
            result = cookie;
            break;
          }

          if (!key) {
            result[name] = cookie;
          }
        } catch (e) {}
      }

      return result;
    }

    api.set = api;
    api.get = function (key) {
      return api.call(api, key);
    };
    api.getJSON = function () {
      return api.apply({
        json: true
      }, [].slice.call(arguments));
    };
    api.defaults = {};

    api.remove = function (key, attributes) {
      api(key, '', extend(attributes, {
        expires: -1
      }));
    };

    api.withConverter = init;

    return api;
  }

  return init(function () {});
}));


/***************************** CUSTOM FUNCTIONS *****************************/


// Retrieve a named value from query string
function oreillyUTM_getQueryStringValue(key) {
  key = key.replace(/[*+?^$.\[\]{}()|\\\/]/g, "\\$&"); // escape RegEx meta chars
  var match = location.search.match(new RegExp("[?&]"+key+"=([^&]+)(&|$)"));
  return match && decodeURIComponent(match[1]);
}

// Get domain name
function oreillyUTM_getDomain() {
  var regex = /[\w-]+.(com|net|org|co.uk|co.jp|co|us|hk|id|in|cn)/ig;
  var url = location.hostname;
  return url.match(regex)[0];
}


/************************ UTM TRACKING LOGIC ************************/


// Create empty object for UTM parameters
var oreillyUTM_queryStringUtmVals = {};

// Set cookie domain from current domain
oreillyUTM_cookieDomain = oreillyUTM_getDomain();

// Retrieve all UTM query string params and values, store to object
for( property in oreillyUTM_fields ) {
  if(oreillyUTM_getQueryStringValue(property) && oreillyUTM_getQueryStringValue(property).length > 0) {
    oreillyUTM_queryStringUtmVals[oreillyUTM_fields[property]] = oreillyUTM_getQueryStringValue(property);
  }
}

// If we have any UTM query string values...
if(Object.keys(oreillyUTM_queryStringUtmVals).length > 0) {  
  // Then create or update the cookie with whatever query string variables are available
  Cookies.set('oreillyUTM_vals', oreillyUTM_queryStringUtmVals , { expires: 3652, domain: '.'+ oreillyUTM_cookieDomain });
}


document.querySelectorAll("form[data-pardot-form]").forEach((form) => {
  form.addEventListener("submit", (event) => {

    // Is there a cookie set with UTM values?
    if( typeof Cookies.getJSON('oreillyUTM_vals') != "undefined" ) {
      // Yes, the cookie is set

      // Loop through the JSON object
      for (const [key, value] of Object.entries(Cookies.getJSON('oreillyUTM_vals'))) {
        // Create a hidden field
        const hiddenField = document.createElement("input");
        hiddenField.type = "hidden";
        hiddenField.name = key;
        hiddenField.value = value;

        // Append the hidden field to the document
        form.appendChild(hiddenField);
      }

      // Before form submission, delete the cookie
      Cookies.remove('oreillyUTM_vals', { domain: '.' + oreillyUTM_cookieDomain } );
    }
    

    // Send form events to GA

    //Send referring source to Goggle Analytics, if present
    if (form['referring_source'] !== undefined) {
      var referringSource = form['referring_source'].value;
      if (referringSource !== undefined && referringSource !== '') {
        referringSource = referringSource.replace(/\s+/g, '-').toLowerCase();
        dataLayer.push({
          'event': 'eventTracker',
          'eventCat': 'marketing',
          'eventAct': 'how did you hear about us',
          'eventLbl': referringSource,
          'eventVal':0, 
          'nonInteraction':0
        });
      }
    }

    //Send on-submit tracking, if present
    if (form.getAttribute('data-pardot-form') !== undefined) {
      const trackingArray = form.getAttribute('data-pardot-form').split(', ');

      if (trackingArray.length >= 3) {
        const trackingCategory = trackingArray[0].toLowerCase();
        const trackingAction = trackingArray[1].toLowerCase();
        const trackingLabel = trackingArray[2].toLowerCase();

        dataLayer.push({
          'event': 'eventTracker',
          'eventCat': trackingCategory,
          'eventAct': trackingAction,
          'eventLbl': trackingLabel,
          'eventVal': 0, 
          'nonInteraction': 0
        });
      }
    }
  }, { once: true });
});