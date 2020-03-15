const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')('sk_test_6unolxOGoLeFa0qg7XIiPVIs00lsFgpfK3');
const cors = require('cors')({ origin: true });

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
exports.purchaseProperty = functions.https.onRequest(async (request, response) => {
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
                const buyerDoc = docs[0];
                const propertyDoc = docs[1];

                // verify documents
                if (!buyerDoc.exists) throw new Error('buyer-f');
                else if (!propertyDoc.exists) throw new Error('prop-f');
                else {
                    const buyer = buyerDoc.data();
                    const property = propertyDoc.data();

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
        switch (err.message) {
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



/*** PAYMENT FUNCTIONS ***/

exports.startPayment = functions.https.onRequest(async (request, response) => {
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
            decoded => { userId = decoded.uid; },
            err => { throw new Error('auth-f'); }
        );

        // create stripe session
        const session = await stripe.checkout.sessions.create({
            client_reference_id: userId,
            payment_method_types: ['card'],
            line_items: [{
                name: 'Add Balance',
                description: 'Purchase balance that will instantly be loaded into your account.',
                images: [],
                amount: 100,
                currency: 'usd',
                quantity: 1
            }],
            success_url: 'http://localhost:3000/',
            cancel_url: 'http://localhost:3000/'
        });

        // return https response
        cors(request, response, () => {
            response.send({ 
                success: true,
                session: session
            });
        });
    }
    catch (err) {
        console.log('startPayment: ' + err);
        cors(request, response, () => {
            response.send({ success: false });
        });
    }
});