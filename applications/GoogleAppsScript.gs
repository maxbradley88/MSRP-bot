/**
 * MSRP Google Forms → Discord bridge (one installable trigger PER Google Form).
 * Create a Google Apps Script project bound to the form, paste this file, set
 * script properties listed in SETUP.md, and install onFormSubmit trigger.
 * The transport webhook is NOT the final application post; the bot processes it.
 */
function onFormSubmit(e) {
  if (!e || !e.response || !e.source) throw new Error('Use an installable Google Form submit trigger');
  var props = PropertiesService.getScriptProperties();
  var webhook = props.getProperty('MSRP_DISCORD_WEBHOOK_URL');
  var secret = props.getProperty('MSRP_FORMS_SECRET');
  var formName = props.getProperty('MSRP_FORM_NAME');
  if (!webhook || !secret || !formName) throw new Error('Missing application bridge Script Properties');
  var items = e.response.getItemResponses();
  if (!items.length) throw new Error('No responses received');
  var answers = items.map(function(item) {
    var raw = item.getResponse();
    return {question: item.getItem().getTitle(), answer: Array.isArray(raw) ? raw.join(', ') : String(raw == null ? '' : raw)};
  });
  var payload = {
    formName: formName,
    formId: e.source.getId(),
    responseId: e.response.getId(),
    discordUserId: String(answers[0].answer || '').trim(),
    answers: answers
  };
  var text = JSON.stringify(payload);
  var hmac = Utilities.computeHmacSha256Signature(text, secret);
  var signature = hmac.map(function(b) {return ('0' + (b & 255).toString(16)).slice(-2);}).join('');
  var envelope = JSON.stringify({payload: payload, signature: signature});
  var response = UrlFetchApp.fetch(webhook, {
    method: 'post',
    payload: {
      'payload_json': JSON.stringify({content: 'msrp_form_bridge', allowed_mentions:{parse:[]}}),
      'files[0]': Utilities.newBlob(envelope, 'application/json', 'msrp_application.json')
    },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Discord bridge POST failed: ' + response.getResponseCode() + ' ' + response.getContentText());
  }
}
