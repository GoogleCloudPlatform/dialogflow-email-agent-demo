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
 * @fileoverview Utilities for 
 *  queuing matched intents and generating responses from a Dialogflow Agent
 */


/**
 * Get the queue state for a threadId of active and remaining Dialogflow sessions
 * @param {datastoreClient} api client for firestore in datastore mode
 * @param {threadId} id of the gmail email thread
 */
async function getQueueState(datastoreClient, threadId) {
  const messageKey = datastoreClient.key(['emailThreadsAndSessions', threadId]);
  const [message] = await datastoreClient.get(messageKey);
  console.log(message);
  if (message) {
    return {
        activeSession: message.activeSession,
        remainingSessions: message.sessionIds,
    };
  } else {
    return {
        activeSession: '',
        remainingSessions: [],
    };
  }
}

/**
 * Respond when there is no active session.
 * In this case we will loop over all sentences of the message body.
 * We will only return responses where there is an intent match.
 * @param {dfClient} dialogflow api client
 * @param {sentences} array of sentences from the email body
 * @param {gcpProject} GCP project id
 * @param {location} agent location ex. us-central1
 * @param {agentId} id of dialogflow agent
 */
async function respondNoActiveSession(dfClient, sentences, gcpProject, location, agentId) {
    const languageCode = 'en';
    var responses = [];
    var sessionIds = [];
    var session;
    
    for (const sentence of sentences) {
        console.log('Input into DF agent:');
        console.log(sentence);
        
        session = Math.random().toString(36).substring(7);
        sessionIds.push(session);
        
        const sessionPath = dfClient.projectLocationAgentSessionPath(
          gcpProject,
          location,
          agentId,
          session
        );
        console.info(sessionPath);
        const request = {
          session: sessionPath,
          queryInput: {
            text: {
              text: sentence.input,
            },
            languageCode,
            },
          };
        const [response] = await dfClient.detectIntent(request);
        console.log(response);
        
        if (response.queryResult.match.matchType != 'NO_MATCH') {
            var full_response = '';
            for (const message of response.queryResult.responseMessages) {
               if (message.text) {
                  full_response = full_response + message.text.text + ' ';
               }
            }

            responses.push({
               response: full_response + ' <br>',
               intent: response.queryResult.match.intent.displayName,
               session: session,
               currentPage: response.queryResult.currentPage.displayName
            });
        }
    }
    
    return responses;
}


/**
 * Use Dialogflow to respond when there are active and open sessions.
 * @param {dfClient} dialogflow api client
 * @param {sentence} user input from the last email in the thread that continues prior conversation
 * @param {activeSession} the active dialogflow session that is taking place in the thread
 * @param {remainingSessions} remaining sessions to be completed based on the initial email of the thread
 * @param {gcpProject} GCP project id
 * @param {location} agent location ex. us-central1
 * @param {agentId} id of dialogflow agent
 */
async function respondToActiveSessions(dfClient, sentence, activeSession, remainingSessions, gcpProject, location, agentId) {
    const languageCode = 'en'; 
    var responses = [];
    var next_session = '';
    var session_to_complete = [];
    
    console.log('Input into DF agent:');
    console.log(sentence);

    // If email response is <=256 characters, query dialogflow for response
    if (sentence.length <= 256) {
        const sessionPath = dfClient.projectLocationAgentSessionPath(
            gcpProject,
            location,
            agentId,
            activeSession
        );
        console.info(sessionPath);
        const request = {
            session: sessionPath,
            queryInput: {
                text: {
                    text: sentence,
                },
                languageCode,
                },
            };
        const [response] = await dfClient.detectIntent(request);
        console.log(response);

        // Join full agent response
        var full_response = '';
        for (const message of response.queryResult.responseMessages) {
            if (message.text) {
                full_response = full_response + message.text.text + ' ';
            }
        }
        // If it isn't end of session, keep the current dialogflow active session.
        // Otherwise, get a new session to complete from the remaining sessions.
        if (response.queryResult.currentPage.displayName != 'End Session') {
            responses.push({
                response: full_response + ' <br>',
                session: activeSession
            });
        } else {
            next_session = remainingSessions.pop();

            if (next_session) {
                activeSession = next_session.session;
                full_response = full_response + ' <br><br> ' + next_session.response;
            } else {
                activeSession = '';
            }
            
            responses.push({
                response: full_response,
                session: activeSession
            });
        }
    } else {
        responses.push({
          response: 'Your response was greater than the 256 characters. Please reply again with a shorter response. <br>',
          session: activeSession
        });
    }
   
    console.log('Replies to active sessions:');
    console.log(responses);
    return {
        responses,
        remainingSessions,
        activeSession
    };
}

module.exports.getQueueState = getQueueState;
module.exports.respondNoActiveSession = respondNoActiveSession;
module.exports.respondToActiveSessions = respondToActiveSessions;