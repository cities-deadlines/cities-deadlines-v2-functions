const functions = require('firebase-functions');
const admin = require('firebase-admin');
var cors = require('cors')({ origin: true });

// initialize app 
admin.initializeApp(functions.config().firebase);
const db = admin.firestore();

// initialize constants
const VALUE_GROWTH_RATE = 1.15;



/*** USER FUNCTIONS ***/

// (AUTH) add user to db upon creation
exports.addUser = functions.auth.user().onCreate(user => {
    return db.collection('users').doc(user.uid).set({
        id: user.uid,
        balance: 0,
        properties: []
    });
});



/*** PROPERTY FUNCTIONS ***/

// (HTTP) purchase property for user
exports.purchaseProperty = functions.https.onRequest(async (req, res) => {
    try {

        // handle preflight
        if (request.method == 'OPTIONS') {
            return cors(request, response, () => {
                response.send({ success: true });
            });
        }

        // enforce authentication
        var userId = undefined;
        const token = request.get('Authorization');
        if (!token) throw new Error('auth-r');
        await admin.auth().verifyIdToken(token).then(
            decoded => { userId = decoded.user_id; }, 
            err => { throw new Error('auth-f'); }
        );

        // fetch target property
        const propertyId = request.get('Property');
        if (!propertyId) throw new Error('prop-r');

        // run purchase transaction
        const buyerRef = db.collection('users').doc(userId);
        const propertyRef = db.collection('properties').doc(propertyId);
        await db.runTransaction(transaction => {
            return transaction.getAll(buyerRef, propertyRef).then(docs => {
                [buyer, property] = docs;

                // verify documents
                if (!buyer.exists) throw new Error('buyer-f');
                else if (!property.exists) throw new Error('prop-f');
                else {

                    // verify balance
                    if (buyer.balance < property.price) 
                        throw new Error('balance');

                    // verify ownership
                    if (buyer.properties.includes(property.id) || (buyer.id === property.owner))
                        throw new Error('ownership');

                    // execute purchase
                    else {
                        const sellerRef = db.collection('users').doc(property.owner);
                        const transactionRef = propertyRef.collection('transactions')
                            .doc(String(property.transactionCount));

                        // update property
                        transaction.update(propertyRef, {
                            owner: buyer.id,
                            value: property.price,
                            price: Math.ceil(property.price * VALUE_GROWTH_RATE),
                            transactionCount: admin.firestore.FieldValue.increment(1)
                        });

                        // set property transaction
                        transaction.set(transactionRef, {
                            buyer: buyer.id,
                            seller: property.owner,
                            price: property.price,
                            timestamp: admin.firestore.FieldValue.serverTimestamp()
                        });
                        
                        // update buyer
                        transaction.update(buyerRef, {
                            balance: admin.firestore.FieldValue.increment(-property.price),
                            properties: admin.firestore.FieldValue.arrayUnion(property.id)
                        });

                        // update seller
                        transaction.update(sellerRef, {
                            balance: admin.firestore.FieldValue.increment(property.price),
                            properties: admin.firestore.FieldValue.arrayRemove(property.id)
                        });
                    }
                }
            });
        }); 

        // return https response
        cors(request, response, () => {
            response.send({ success: true });
        });
    }
    catch (err) {
        console.log('purchaseProperty: ' + err);
        var message = '';

        // select error message
        switch(err.message) {
            case 'auth-r': message = 'Error authenticating user. Please refresh page.'; break;
            case 'auth-f': message = 'Error authenticating user. Please refresh page.'; break;
            case 'prop-r': message = 'Error retrieving property. Please wait and try again.'; break;
            case 'prop-f': message = 'Error fetching property. Please wait and try again.'; break;
            case 'buyer-f': message = 'Error fetching user. Please wait and try again.'; break;
            case 'balance': message = 'Insufficient balance for purchasing property.'; break;
            case 'ownership': message = 'You cannot purchase properties that you already own.'; break;
            default: message = 'Unexpected server error. Please wait and try again.'; break;
        }

        cors(request, response, () => {
            response.send({ 
                success: false,
                message: message
            });
        });
    }
});