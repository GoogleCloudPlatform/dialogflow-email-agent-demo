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
 * @fileoverview Authorizes and returns gmail client
 */

const {google} = require('googleapis');
const fs = require('fs');
const readline = require('readline');
const util = require('util');
const readFile = util.promisify(fs.readFile);

const fsp = fs.promises;

const TOKEN_PATH = 'token.json'

readline.Interface.prototype.question[util.promisify.custom] = function(prompt) {
    return new Promise(resolve =>
        readline.Interface.prototype.question.call(this, prompt, resolve),
    );
};

readline.Interface.prototype.questionAsync = util.promisify(readline.Interface.prototype.question);

/**
 * Create an OAuth2 client with the given credentials
 * @param {oAuth2Client} googleapis oAuth2Client
 */
async function authorize(oAuth2Client) {
  const token = await readFile(TOKEN_PATH);
  oAuth2Client.setCredentials(JSON.parse(token));
  console.log('Set oAuth Credentials successful.');
  return oAuth2Client;
}

/**
 * Get and store new token after prompting for user authorization
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {scopes} Authorization scopes.
 */
async function getAccessToken(oAuth2Client, scopes) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });

  console.log('Authorize this app by visiting this url:', authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const code = await rl.questionAsync('Enter the code from that page here: ');
  rl.close();

  try {
    const token = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(token.tokens);
    // Store the token to disk for later program executions
    await fsp.writeFile(TOKEN_PATH, JSON.stringify(token.tokens));
    return oAuth2Client
  } catch (error) {
    console.error('Error retrieving access token', error);
    throw error;
  }
}

/**
 * Return an authorized Gmail client to the user.
 * @param {cred_path} Path to json file of Oauth client credentials.
 * @param {scopes} Authorization scopes.
 */
const newClient = async (cred_path, scopes) => {
  const creds = await readFile(cred_path);
  const credentials = JSON.parse(creds);
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id, client_secret, redirect_uris[0]);
  console.log('Create oAuth Client successful.');
    
  if (!fs.existsSync(TOKEN_PATH)) {
    await getAccessToken(oAuth2Client, scopes);
  }
  //const authorize_client = util.promisify(authorize);
  const oauth_client = await authorize(oAuth2Client);
  console.log(oauth_client);
  const client = await google.gmail({version: 'v1', auth: oauth_client});
  return client;
}

module.exports.newClient = newClient;
