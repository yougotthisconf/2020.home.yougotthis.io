require('dotenv').config()

const axios = require('axios')

const base = require('airtable').base(process.env.AIRTABLE_BASE_ID);

const SmartyStreetsSDK = require("smartystreets-javascript-sdk");
const SmartyStreetsCore = SmartyStreetsSDK.core;
const Lookup = SmartyStreetsSDK.internationalStreet.Lookup;
const credentials = new SmartyStreetsCore.StaticCredentials(process.env.SMARTY_AUTH_ID, process.env.SMARTY_AUTH_TOKEN);
let smarty = SmartyStreetsCore.buildClient.internationalStreet(credentials);

const SparkPost = require('sparkpost');
const sparkpost = new SparkPost(process.env.SPARKPOST_API_KEY);

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
}

exports.handler = async (event, context) => {
    try {
        if (event.httpMethod !== 'POST') {
            return { headers, statusCode: 200, body: JSON.stringify({ error: 'Invalid method' }) }
        }

        const { first_name, last_name, email, address, country, newsletter } = JSON.parse(event.body);
        const hasProvidedAddress = address && country;
        
        if(!first_name || !last_name || !email) {
            return { headers, statusCode: 500, body: JSON.stringify({ error: 'You must provide your first name, last name and email.' }) }
        }

        if(await checkIfEmailExists(email)) {
            return { headers, statusCode: 500, body: JSON.stringify({ error: 'You have already registered.' }) }
        } else {
            let fullAddress = false;
            if(hasProvidedAddress) fullAddress = await validateAddress(address, country);

            await createAttendee(first_name, last_name, email, fullAddress.address, fullAddress.address_verified);
            await sendEmail(email, fullAddress);
            if(newsletter) await subscribeToNewsletter(email)

            if(fullAddress) {
                return { headers, statusCode: 200, body: JSON.stringify({address: true, verified: fullAddress.address_verified}) }
            } else {
                return { headers, statusCode: 200, body: JSON.stringify({address: false}) }
            }
        }
    } catch (err) {
        console.error(err)
        return { headers, statusCode: 500, body: JSON.stringify({ error: 'We had trouble registering you. If this error persists please email us.' }) }
    }
}

async function checkIfEmailExists(email) {
    return new Promise((resolve, reject) => {
        base('Attendees').select({
            filterByFormula: `({email}="${email}")`
        }).eachPage(records => {
            resolve(records.length > 0)
        }, err => {
            if (err) { reject(new Error(err)) }
        });
    })
}

async function validateAddress(freeform, country) {
    return new Promise((resolve, reject) => {
        let address = new Lookup();
        address.country = country;
        address.freeform = freeform;

        smarty.send(address).then(results => {
            const result = results.result[0];
            const { analysis: { verificationStatus: verify, addressPrecision: precision } } = result;
            const isVerified = verify == "Verified" && (precision == "Premise" || precision == "DeliveryPoint")            
            let completedAddress = `${address}, ${country}`;
            if(isVerified) {
                let a = [];
                for(let i=1; i<13; i++) {
                    if(result[`address${i}`]) a.push(result[`address${i}`])
                }
                completedAddress = a.join(', ')
            }
            
            resolve({ address: completedAddress, address_verified: isVerified })
        }).catch(err => {
            console.error(err)
            reject(new Error(err))
        })
    })
}

async function createAttendee(first_name, last_name, email, address, address_verified) {
    return new Promise((resolve, reject) => {
        base('Attendees').create({ 
            first_name, last_name , email, address, address_verified
        }, err => {
            if (err) { return reject(new Error(err)) }
            return resolve(true)
        });
    });
}

async function sendEmail(email, address) {
    return new Promise((resolve, reject) => {
        let message = `
            <p>Hey there,</p>
            <p>Thank you so much for registering to take part in You Got This 2020: From Home. We hope you will enjoy the event.</p>
            <p>Please feel free to share the event with your friends and colleagues so we can positively impact as many people as possible.<p>
        `
        if(address && address.address_verified) {
            message += `<p>We'll be sending out stickers closer to the event. We successfully verified your address so there shouldn't be any issues with getting them to you.</p>`
        } 
        if(address && !address.address_verified) {
            message += `<p>We'll be sending out stickers closer to the event. Just to let you know - we struggled to verify your address. If ${address.address} is correct, there shouldn't be a problem, but if it's incorrect please get in touch with us so we can amend it.</p>`
        }
        message += `
            <p>We'll send you a couple of important updates before the day, and if you want more regular updates consider <a href="https://twitter.com/yougotthisconf">following us on Twitter.</a></p>
            <p>Much love</p>
            <p><a href="https://twitter.com/_phzn">Kevin</a> & <a href="https://twitter.com/ShyRuparel">Shy</a> - the You Got This 2020: From Home team</p>
        `
        sparkpost.transmissions.send({
            content: {
                from: {
                    name: 'You Got This Team',
                    email: 'kevin@yougotthis.io'
                },
                subject: 'Registration for You Got This 2020: From Home',
                html: message
            },
            recipients: [{ address: email }]
        }).then(data => {
            resolve(true)
        }).catch(err => {
            console.error(err);
            reject(new Error(err))
        })
    });
}

async function subscribeToNewsletter(email) {
    return new Promise((resolve, reject) => {
        axios({
            url: 'https://api.buttondown.email/v1/subscribers',
            method: 'POST',
            headers: {
                Authorization: `Token ${process.env.BUTTONDOWN_API_KEY}`
            },
            data: {
                email,
                tags: ['home-2020']
            }
        }).then(data => {
            resolve(true)
        }).catch(err => {
            console.error(err);
            resolve(true)
        })
    })
}