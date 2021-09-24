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
 * @fileoverview Utilities for integrating with Google Cloud ML services
 */


/**
 * Make a call to AutoML Entity Extraction for parsing the email signature.
 * Returns the signature and the email body without the signature.
 * @param {content} text content that is fed into the ml model
 * @param {autoMlClient} initialized AutoMlClient
 * @param {entityExtractModel} path of entity extraction model
 */
async function signaturePredict(content, autoMlClient, entityExtractModel) {
    // Construct request
    const request = {
      name: entityExtractModel,
      payload: {
        textSnippet: {
          content: content,
          mimeType: 'text/plain', // Types: 'test/plain', 'text/html'
        },
      },
    };    
    console.log(request);

    const [response] = await autoMlClient.predict(request);

    signature = "";
    cleanBody = content;
    
    for (const annotationPayload of response.payload) {
      console.log(
        `Text Extract Entity Types: ${annotationPayload.displayName}`
      );
      console.log(`Text Score: ${annotationPayload.textExtraction.score}`);
      const textSegment = annotationPayload.textExtraction.textSegment;
      console.log(`Text Extract Entity Content: ${textSegment.content}`);
      console.log(`Text Start Offset: ${textSegment.startOffset}`);
      console.log(`Text End Offset: ${textSegment.endOffset}`);
      
      signature = signature + textSegment.content;
      cleanBody = cleanBody.replace(textSegment.content, '');
    }
    
    // Return cleanBody which contains the email body without the predicted signature
    return {
        signature: signature,
        cleanBody: cleanBody
    };
}


/**
 * Make a call to the NLP API to get an array of sentences from the text input
 * @param {content} text content that is fed into the NLP API
 * @param {nlpApiClient} initialized NLP API client
 */
async function parseSentences(content, nlpApiClient) {
    sentences = [];    

    const document = {
      content: content,
      type: 'PLAIN_TEXT',
    };

    // Leverage NLP API capability of returning sentences of a document
    const [result] = await nlpApiClient.analyzeSentiment({document: document});
    console.log(result);
    
    for (const sentence of result.sentences) {
        sentences.push({
            input: sentence.text.content,
        });
    }
    return sentences;
}


/**
 * Make a call to AutoML Text Classifier for inferring the email topics.
 * Perform a lookup against Firestore to provide relevant links to the user.
 * @param {content} text content that is fed into the ml model
 * @param {autoMlClient} initialized AutoMlClient
 * @param {textClassifyModel} path of entity extraction model
 * @param {datastoreClient} datastore client used to perform a lookup
 */
const topicClassifier = async (content, autoMlClient, textClassifyModel, datastoreClient) => {
    // Construct request
    const request = {
      name: textClassifyModel,
      payload: {
        textSnippet: {
          content: content,
          mimeType: 'text/plain', // Types: 'text/plain', 'text/html'
        },
      },
    };

    const [response] = await autoMlClient.predict(request);
    console.log(response)

    topics = [];
    for (const annotationPayload of response.payload) {
      console.log(`Predicted class name: ${annotationPayload.displayName}`);
      console.log(
        `Predicted class score: ${annotationPayload.classification.score}`
      );
      if (annotationPayload.classification.score > .5) {  // classifier threshold
        const transaction = datastoreClient.transaction();
        await transaction.run();
        const messageKey = datastoreClient.key(['knowledgeBase', annotationPayload.displayName]);
        const [entity] = await transaction.get(messageKey);
        console.log(entity);
        
        topics.push({
          topic: annotationPayload.displayName,
          documentation: entity.url,
        });
      }
    }
    return topics;
}

module.exports.topicClassifier = topicClassifier;
module.exports.signaturePredict = signaturePredict;
module.exports.parseSentences = parseSentences;