const functions = require('firebase-functions');
const admin = require('firebase-admin');
var cors = require('cors')({ origin: true });

// initialize app 
admin.initializeApp(functions.config().firebase);
const db = admin.firestore();