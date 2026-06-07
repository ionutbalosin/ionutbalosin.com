document.addEventListener("DOMContentLoaded", function(event) {
  setCountryListenerMCForm();
  toggleThankYouMCForm();
  moveConferenceCTA();
});

// Move Coding with AI promotion for specific articles
function moveConferenceCTA() {
  //const validPaths = ['/radar/think-different/', '/radar/ascending-levels-of-nerd/', '/radar/bridging-the-ai-learning-gap/'];
  const validPaths = ['/radar/think-different/'];
  if (validPaths.includes(window.location.pathname)) {
    const articleBody = document.querySelector('div.main-post-radar-content');
    const conferencePromo = document.querySelector('div.main-post-radar-content > p.has-background');
    const platformTrialPromo = document.querySelector('div.main-post-radar-content .trial-cta')?.parentElement;

    if (articleBody && conferencePromo) {
      if (conferencePromo) {
        // Move conference promo
        const paragraphs = articleBody.querySelectorAll('p');
        if (paragraphs.length >= 4) {
          articleBody.insertBefore(conferencePromo, paragraphs[4]);
        }
      }

      // Move platform trial promo
      if (platformTrialPromo) {
        articleBody.appendChild(platformTrialPromo);
      }

      // Hide extra spacers
      document.querySelector('div.main-post-radar-content > .wp-block-spacer')?.remove();
      document.querySelector('div.main-post-radar-content > .wp-block-separator')?.remove();
    }
  }
}

function parseParamsMCForm(name) {
  name = name.replace(/[\[]/,"\\\[").replace(/[\]]/,"\\\]");  
  var regexS = "[\\?&]"+name+"=([^&#]*)";
  var regex = new RegExp( regexS );  
  var results = regex.exec( window.location.href ); 
  if (results == null) { return "";  }
  else { return results[1]; }
}

function toggleHiddenMCForm() {
  var targets = Array.prototype.slice.call(arguments);
  targets.forEach(function(target) {
    document.getElementById(target).classList.toggle('hidden');
  });
}

// Hide the forms and show the thankyou message depending on a URL parameter
function toggleThankYouMCForm() {
  if (parseParamsMCForm('submit') === 'true') {
    toggleHiddenMCForm('marketingCloudForm', 'marketingCloudForm-thankyou');
    history.pushState(null, "", window.location.href.split("?")[0]);
  }
}

function setCountryListenerMCForm() {
  var countries = document.querySelectorAll('#marketingCloudForm [name="country"]');
  for (i = 0; i < countries.length; i++ ) {
    countries[i].addEventListener('change', function (e) {
      var country = this.value;
      checkOptInStatusMCForm(country);
    }); 
  }
}

function checkOptInStatusMCForm(country) {
  var gdprSelect = document.getElementById('consentGroup');
  var optInHtml = '\n <fieldset role="radiogroup" aria-required="true" data-text="choice for receiving O&rsquo;Reilly email updates"><input type="radio" name="Marketing_Consent" class="consent" id="consentYes" value="True"> \n   <label for="consentYes">Yes</label> \n   <input type="radio" name="Marketing_Consent" class="consent" id="consentNo" value="False"> \n   <label for="consentNo">No</label> \n   <p>I would like to receive email updates from O&rsquo;Reilly on its latest ideas, events, <span class="nowrap">and offers.</span></p> \n </fieldset>';

  if (requiresConsentMCForm(country) && gdprConsentHiddenMCForm(gdprSelect)) {
    gdprSelect.classList.toggle('hidden');
    gdprSelect.innerHTML = optInHtml;
  } else if (!requiresConsentMCForm(country) && !gdprConsentHiddenMCForm(gdprSelect)) {
    gdprSelect.classList.toggle('hidden');
    gdprSelect.innerHTML = '';
  }
}

function requiresConsentMCForm(country) {
  var euCountries = ['Austria', 'Belgium', 'Bulgaria', 'China', 'Croatia', 'Republic of Cyprus', 'Czech Republic', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland', 'Italy', 'Latvia', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Norway', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'United Kingdom'];
  return(euCountries.indexOf(country) + 1);
}

function gdprConsentHiddenMCForm(gdprSelect) {
  return gdprSelect.classList.contains('hidden') ? true : false;
}

function verifMCForm(formName) {
  const formId = '#marketingCloudForm';
  const form = document.getElementById('marketingCloudForm');
  const curURL = window.location.href.split("?")[0];

  //Loop through each previous error and remove the class and aria-invalid attribute
  const errorItems = document.querySelectorAll('#marketingCloudForm .error');
  errorItems.forEach(function(item) {
    item.classList.remove('error');
    item.removeAttribute('aria-invalid');
  });

  var errors = [];

  //Loop through each required field
  const requiredFields = document.querySelectorAll('#marketingCloudForm [aria-required$="true"]');
  requiredFields.forEach(function(field) {
    if (fieldInvalidMCForm(field, form)) {
      createErrorMCForm(field, '#marketingCloudForm', 'marketingCloudForm', errors);
    };
  });

  // If errors found, display them and prevent submit
  if (errors.length > 0) {
    displayErrorsMCForm(errors);
    return false;
  }

  // When no errors found continue...

  //Set values for _successURL and _errorURL fields
  form.elements['_successURL'].value = curURL + "?submit=true";
  form.elements['_errorURL'].value = curURL + "?error=true";
  form.elements['Marketing_Context'] = "email signup at " + curURL;
  
  // Push dataLayer event for Goggle Analytics
  var emailTopic = '';
  if (document.getElementById('marketingCloudForm').elements['NewsletterTopic'] != undefined) {
    emailTopic = document.getElementById('marketingCloudForm').elements['NewsletterTopic'].value.toLowerCase(); 
  }
  dataLayer.push({
    'event': 'eventTracker',
    'eventCat':'radar',
    'eventAct':'newsletter',
    'eventLbl': emailTopic,
    'eventVal':0,
    'nonInteraction':0
  });

  return true;
  //return false;
}

function fieldInvalidMCForm(field, form) {
  if (field.tagName === 'FIELDSET') {
    return (consentInvalidMCForm(field, form)) ? true : false;
  } else if (field.name === "email") {
    return (emailInvalidMCForm(form)) ? true : false;
  } else {
    return (field.value.length < 1) ? true : false;
  }
}

function consentInvalidMCForm(field, form) {
  if (form.elements['Marketing_Consent'].value.length < 1) {
    return true;
  }
}

function emailInvalidMCForm(form) {
  var mail = new RegExp('@+','g');
  if ( (form.email.value.length < 1) || (!mail.test(form.email.value)) ) {
    return true;
  }
}

function createErrorMCForm(field, formId, formName, errors) {
  if (field.tagName === 'fieldset') {
    field.classList.add('error');
  } else {
    field.classList.add('error');
    field.setAttribute('aria-invalid','true');
  }
  errors.push(field.dataset.text);
}

function displayErrorsMCForm(errors) {
  var errorMessage = '';
  if (errors.length > 3) {
    errorMessage = '<p>Please fill out all required fields.</p>';
  }
  else {
    errorMessage = '<p>Please enter your ';
    for (i = 0; i < errors.length; i++) {
      errorMessage += errors[i];
      if (i === errors.length - 2) {
        errorMessage += ', and '
      }
      else if (i < errors.length - 1) {
        errorMessage += ', '
      }
      else {
        errorMessage += '.</p>'
      }
    }
  }

  document.getElementById('marketingCloudForm-errorMessage').innerHTML = errorMessage;
}