
# Copyright 2021 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Cloud Function for configuring Gmail API Push Notifications"""

from __future__ import print_function
import os

from googleapiclient.discovery import build
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

# Environment Variables - see config.yaml
GCP_PROJECT = os.environ.get('GCP_PROJECT')
PUBSUB_TOPIC = os.environ.get('PUBSUB_TOPIC')
GMAIL_ID = os.environ.get('GMAIL_ID')

# Other Variables
TOKEN_FILE = 'token.json'
OAUTH_CLIENT_CREDS = 'client_credentials.json'

# If modifying these scopes, delete the file token.json.
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

def main():
    """Configures Push Notifications from 
    the Gmail API to Pub/Sub for the Gmail 
    or Google Workspace inbox provided.
    """
    creds = None
    # The file token.json stores the user's access and refresh tokens, and is
    # created automatically when the authorization flow completes for the first
    # time.
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                OAUTH_CLIENT_CREDS, SCOPES)
            creds = flow.run_console()
        # Save the credentials for the next run
        with open(TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())

    service = build('gmail', 'v1', credentials=creds)

    # Call the Gmail API
    request = {
    'labelIds': ['INBOX'],
    'topicName': 'projects/' + GCP_PROJECT + '/topics/' + PUBSUB_TOPIC
    }
    result = service.users().watch(userId=GMAIL_ID, body=request).execute()
    print(result)

if __name__ == '__main__':
    main()