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
 * @fileoverview main method for email based support agent
 */

const {Datastore} = require('@google-cloud/datastore');
const {SessionsClient} = require('@google-cloud/dialogflow-cx').v3beta1;
const {PredictionServiceClient} = require('@google-cloud/automl').v1;
const language = require('@google-cloud/language');

const fs = require('fs');
const readline = require('readline');
const util = require('util');
const readFile = util.promisify(fs.readFile);

const gmailHelper = require('./gmail_auth_helper.js');
const emailUtils = require('./email_utils.js');
const mlUtils = require('./ml_utils.js');
const dfUtils = require('./dialogflow_utils.js');

// Oauth2 access scopes
// If modifying these scopes, delete token.json to regenerate.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 
                'https://www.googleapis.com/auth/gmail.compose'];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';
const CLIENT_CREDS = 'client_credentials.json';
const GMAIL_ID = process.env.GMAIL_ID;
const GCP_PROJECT = process.env.GCP_PROJECT;
const LOCATION = process.env.LOCATION;
const AGENT_ID = process.env.AGENT_ID;
const SUBJECT_KEY = process.env.SUBJECT_KEY;
const ENTITY_EXTRACT_MODEL_ID = process.env.ENTITY_EXTRACT_MODEL_ID;
const TOPIC_CLASSIFY_MODEL_ID = process.env.TOPIC_CLASSIFY_MODEL_ID;


// Main method ingests a pubsub event or dictionary if in debug mode
exports.main = async (event, debug=false) => {
  let eventContent;
    
  // If debugging, ingest event as dictionary  
  if (debug==true) {
    eventContent = event;
  } else {
    const data = Buffer.from(event.data, 'base64').toString();
    eventContent = JSON.parse(data);
  }
   
  // Collect agent email address and gmail historyId from pubsub event  
  const email = eventContent.emailAddress;
  const historyId = eventContent.historyId;
  console.log('Finished parsing pubsub event:');
  console.log(eventContent);

  try {
    // Decode the incoming Gmail push notification.
    const gmail = await gmailHelper.newClient('credentials.json', SCOPES);
    //console.log(gmail);
    const datastoreClient = new Datastore();
    // Imports the Google Cloud AutoML library
    const {PredictionServiceClient} = require('@google-cloud/automl').v1;
    // Instantiates an AutoML prediction client
    const autoMlClient = new PredictionServiceClient();
    const entityExtractModel = autoMlClient.modelPath(GCP_PROJECT, LOCATION, ENTITY_EXTRACT_MODEL_ID);
    const topicClassifyModel = autoMlClient.modelPath(GCP_PROJECT, LOCATION, TOPIC_CLASSIFY_MODEL_ID);
    // Instantiate a NL API client
    const nlpApiClient = new language.LanguageServiceClient();
    // Instantiate DF CX Client
    const dfClient = new SessionsClient({apiEndpoint: LOCATION + '-dialogflow.googleapis.com'});
    console.log('Completed API client creation.');
    
    // Get latest message and use Firestore in Datastore Mode to check for duplicates
    const message = await emailUtils.getMostRecentMessage(datastoreClient, gmail, email, historyId);
    console.log('Finished getting most recent message.');
    console.log(message);
      
    if (message) {
        var messageInfo = await emailUtils.extractInfoFromMessage(message, nlpApiClient, autoMlClient, entityExtractModel);
        console.log('Get message info successful.');
        console.log(messageInfo);
        
        // Check for active and open sessions
        var queueState = await dfUtils.getQueueState(datastoreClient, messageInfo.threadId);
        activeSession = queueState.activeSession;
        remainingSessions = queueState.remainingSessions;
        console.log('Continue active Session:');
        console.log(activeSession);
        console.log('Remaining Sessions:');
        console.log(remainingSessions);
        
        var new_responses = [];
        var remaining_sessions = [];
        
        // call respondNoActiveSession when there is no active session
        // only include topic information from text classifier when there are no active dialogflow intents
        if (activeSession == '') {
            // Use AutoML Text Classification to determine the message topic and lookup resources from Firestore
            var topicInfo = await mlUtils.topicClassifier(messageInfo.cleanBody, autoMlClient, topicClassifyModel, datastoreClient);
            console.log('Get topic info succesful.');
            console.log(topicInfo);
            if (topicInfo.length !=0) {
                topic_response = 'We have identified the following topics and related resources by using ML to classify your message. <br>'
                for (const topic of topicInfo) {
                        topic_response = topic_response + '<a href="' + topic.documentation + '">' + topic.topic + '</a><br>';
                }
                new_responses.push({
                    response: topic_response
                });
            }
            
            sessions = await dfUtils.respondNoActiveSession(dfClient, messageInfo.bodySentences, GCP_PROJECT, LOCATION, AGENT_ID);
            
            for (const session of sessions) {
                // If the new session is complete, just send the response
                if (session.currentPage == 'End Session') {
                    new_responses.push(session);
                } else { // Else add to our queue of remaining sessions
                    remaining_sessions.push(session);
                }
            }
            
            // Continue if there are remaining sessions
            if (remaining_sessions) {
                // Pull out a session from remaining sessions to set as active
                // Send the agent response for that session to continue the conversation
                session_to_complete = remaining_sessions.pop();
                if (session_to_complete) {
                    activeSession = session_to_complete.session;
                    new_responses.push(session_to_complete);
                    console.log('Active session set:');
                    console.log(activeSession);
                }
            }
        } else { // Follow this path if there is an active dialogflow session to complete for the corresponding thread in our queue
            console.log('There is an active session to complete.');
            console.log(activeSession);
            let active_session_result = await dfUtils.respondToActiveSessions(dfClient, messageInfo.cleanBody, activeSession, remainingSessions, GCP_PROJECT, LOCATION, AGENT_ID);
            remaining_sessions = active_session_result.remainingSessions;
            activeSession = active_session_result.activeSession;
            new_responses = new_responses.concat(active_session_result.responses);
        }
        
        // Save active session and remaining sessions (state of our queue) to datastore
        const messageKey = datastoreClient.key(['emailThreadsAndSessions', messageInfo.threadId]);
        const queue_state = {
          activeSession: activeSession,
          sessionIds: remaining_sessions
        };
        await datastoreClient.save({
          key: messageKey,
            data: queue_state
        });
        console.log('Saving session data:');
        console.log(queue_state);
        
        if (messageInfo.subject.includes(SUBJECT_KEY)) {  // Subject key ensures that we only respond to messages that have a specific subject
            console.log('Will send reply.');
            console.log(new_responses);
            var success = await emailUtils.replyToMessage(gmail, messageInfo, new_responses, remaining_sessions, activeSession);
            console.log(success);
        }
    }  // end if
  } catch(err) {
      console.log(err);
  } 
  console.log('Finished.');
}