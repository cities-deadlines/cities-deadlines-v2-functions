const functions = require('firebase-functions');
const admin = require('firebase-admin');
var cors = require('cors')({ origin: true });

// initialize app 
admin.initializeApp(functions.config().firebase);
const db = admin.firestore();



/*** USER FUNCTIONS ***/

// add user to db upon creation
exports.addUser = functions.auth.user().onCreate(user => {
    return db.collection('users').doc(user.uid).set({
        uid: user.uid
    });
});

// remove user from db upon deletion
exports.removeUser = functions.auth.user().onDelete(user => {
    return db.collection('users').doc(user.uid).delete();
});