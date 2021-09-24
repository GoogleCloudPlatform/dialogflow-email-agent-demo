/**
 * Copyright 2021 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview Utilities for fetching and responding to email messages
 */

const mlUtils = require('./ml_utils.js');

async function checkForDuplicateNotifications(datastoreClient, messageId) {
  const transaction = datastoreClient.transaction();
  await transaction.run();
  const messageKey = datastoreClient.key(['emailNotifications', messageId]);
  const [message] = await transaction.get(messageKey);
  if (!message) {
    await transaction.save({
      key: messageKey,
      data: {
      }
    });
  }
  await transaction.commit();
  if (!message) {
    return messageId;
  }
};

/**
 * Determine the most recent message to process and respond to
 * @param {datastoreClient} api client for firestore in datastore mode
 * @param {gmail} gmail client for getting message from api
 * @param {email} email address of the agent inbox
 * @param {historyId} historyId of the most recent inbox update from pubsub
 */
async function getMostRecentMessage(datastoreClient, gmail, email, historyId) {
  // Look up the most recent message.
  const listMessagesRes = await gmail.users.messages.list({
    userId: email,
    maxResults: 1
  });
  console.log('Gmail messages list successful.');

  // Check Firestore (in datastore mode) to prevent processing a message twice
  var messageId = await checkForDuplicateNotifications(datastoreClient, listMessagesRes.data.messages[0].id);
  //var messageId = listMessagesRes.data.messages[0].id;
  if (!messageId) {
    console.log('Duplicate. Nothing to do.');
  }
  console.log('Datastore duplicate check successful.');

  // Get the message content from gmail using the message ID.
  if (messageId) {
    const message = await gmail.users.messages.get({
      userId: email,
      id: messageId
    });

    return message;
  }
};

/**
 * Extract information from the email message needed downstream
 * @param {message} raw message returned from the gmail api
 * @param {autoMlClient} initialized AutoML API client for extracting signature
 * @param {nlpApiClient} nlpApiClient for parsing email body into sentences
 */
async function extractInfoFromMessage(message, nlpApiClient, autoMlClient, entityExtractModel) {
  const messageId = message.data.id;
  const threadId = message.data.threadId;
  let from;
  let to;
  let filename;
  let attachmentId;
  let senderName;
  let subject;
  let body;
  let id;
  let references;

  if (message.data.payload.parts) {
    var part = message.data.payload.parts.filter(
      function(part) {
        return part.mimeType == 'text/plain';
      });
    body = Buffer.alloc(
      part[0].body.size,
      part[0].body.data,
      "base64").toString();
    body = body.replace(/\r/g, ' ').replace(/\n/g,' ').replace(/\s\s+/g, ' ');
    // Remove prior thread from body
    body = body.replace(/On .* wrote: > .*/g, '');
  }

  const headers = message.data.payload.headers;
  console.log(headers);
  for (var i in headers) {
    console.log(headers[i].name);
    if (headers[i].name === 'From') {
      from = headers[i].value;
    }
    if (headers[i].name === 'To') {
      to = headers[i].value;
    }
    if (headers[i].name === 'Subject') {
      subject = headers[i].value;
    }
    if (headers[i].name === 'Message-ID') {
      id = headers[i].value;
    }
    if (headers[i].name === 'References') {
      references = headers[i].value;
    }
  }
    
  // Get the first name of the sender
  senderName = /^([a-zA-Z]+\b)/.exec(from)[0];

  const payloadParts = message.data.payload.parts;
  for (var j in payloadParts) {
    if (payloadParts[j].body.attachmentId) {
      filename = payloadParts[j].filename;
      attachmentId = payloadParts[j].body.attachmentId;
    }
  }
    
  // Use Entity Extaction Model to Parse the Signature from the Email Body
  signature_extract = await mlUtils.signaturePredict(body, autoMlClient, entityExtractModel);
  console.log("Signature Extract");
  console.log(signature_extract);
    
  // Use NLP API to parse sentences from the clean email body
  body_sentences = await mlUtils.parseSentences(signature_extract.cleanBody, nlpApiClient);
  console.log("Email Body Sentences");
  console.log(body_sentences);

  return {
    messageId: messageId,
    id: id,
    references: references,
    threadId: threadId,
    from: from,
    to: to,
    subject: subject,
    body: body,
    cleanBody: signature_extract.cleanBody,
    signature: signature_extract.signature,
    bodySentences: body_sentences,
    senderName: senderName,
  };
};

/**
 * Format html response and send using gmail API
 * @param {gmail} gmail client for getting message from api
 * @param {messageInfo} array of extracted info from the original email
 * @param {responses} array of responses from the DF agent
 * @param {remaining_sessions} remaining dialogflow sessions to complete with the user
 * @param {active_sessions} active dialogflow session
 */
async function replyToMessage(gmail, messageInfo, responses, remaining_sessions, active_session) {
  // Initialize string that will contain the response body
  body = 'Hi ' + messageInfo.senderName + ', <br> <br>';
  
  for (const response of responses) {
      body += response.response + '<br>';
  }
    
  if (active_session == '') {
    body += '<br> There are no active sessions with your virtual agent. Feel free to ask about opening or closing a support ticket. <br> <br>';
  }

  body += 'Have a nice day! <br> Demo Support Bot <br>';
    
  console.log(body);
    
  body += '<br>' +
      '<table cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout: fixed; ' + 
        'font-size: 10pt; font-family: Arial; width: 0px; border-collapse: collapse; border: none;">' +
        '<colgroup> <col width="137"> <col width="466"> </colgroup>' +
          '<tbody>' +
            '<tr style="height: 50px;">' +
                '<td style="border: 1px solid rgb(0, 0, 0); overflow: hidden; padding: 2px 3px; ' + 
                  'vertical-align: bottom; background-color: rgb(243, 243, 243); font-weight: bold;">Extracted Signature:</td>' +
                '<td style="border: 1px solid rgb(0, 0, 0); overflow: hidden; padding: 2px 3px; ' + 
                  'vertical-align: bottom; background-color: rgb(243, 243, 243);">' +
                  messageInfo.signature + '</td>' +
            '</tr>' +
            '<tr style="height: 50px;">' +
                '<td style="border: 1px solid rgb(0, 0, 0); overflow: hidden; padding: 2px 3px; ' + 
                  'vertical-align: bottom; background-color: rgb(243, 243, 243); font-weight: bold;">Active Session:</td>' +
                '<td style="border: 1px solid rgb(0, 0, 0); overflow: hidden; padding: 2px 3px; ' + 
                  'vertical-align: bottom; background-color: rgb(243, 243, 243);">' + 
                  active_session +'</td>' +
            '</tr>' +
            '<tr style="height: 50px;">' +
                '<td style="border: 1px solid rgb(0, 0, 0); overflow: hidden; padding: 2px 3px; ' + 
                  'vertical-align: bottom; background-color: rgb(243, 243, 243); font-weight: bold;">Remaining Intents:</td>' +
                '<td style="border: 1px solid rgb(0, 0, 0); overflow: hidden; padding: 2px 3px; ' + 
                  'vertical-align: bottom; background-color: rgb(243, 243, 243);">' + 
                  remaining_sessions.length.toString() + '</td>' +
            '</tr>' +
          '</tbody>' +
      '</table>';
    
  const messages = [
      'From: ' + messageInfo.to,
      'To: ' + messageInfo.from,
      'References: '+ messageInfo.references + ' ' + messageInfo.id,
      'In-Reply-To: '+ messageInfo.id,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      'Subject: Re: ' + messageInfo.subject,
      '',
      body,
      '',
  ];
  const message = messages.join('\n');
  const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  var success = await gmail.users.messages.send({
      //auth: auth,
      userId: 'me',
      resource: {
          raw: encodedMessage,
          threadId: messageInfo.threadId
      }
  });
  return success;
}

module.exports.getMostRecentMessage = getMostRecentMessage;
module.exports.extractInfoFromMessage = extractInfoFromMessage;
module.exports.replyToMessage = replyToMessage;