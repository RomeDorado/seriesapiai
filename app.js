'use strict';

const apiai = require('apiai');
const config = require('./config');
const moment = require('moment');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const uuid = require('uuid');
const Agenda = require('agenda');
const ObjectID = require('mongodb').ObjectID;
const {MONGO_URI} = require('./config');
const agenda = new Agenda({
  db: {
    address: MONGO_URI
  }
});


// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
	throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
	throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
	throw new Error('missing API_AI_CLIENT_ACCESS_TOKEN');
}
if (!config.FB_APP_SECRET) {
	throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
	throw new Error('missing SERVER_URL');
}



app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
	verify: verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
	extended: false
}))

// Process application/json
app.use(bodyParser.json())




const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
	language: "en",
	requestSource: "fb"
});
const sessionIds = new Map();

// Index route
app.get('/', function (req, res) {
	res.send('Hello world, I am a chat bot')
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
	console.log("request");
	if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Failed validation. Make sure the validation tokens match.");
		res.sendStatus(403);
	}
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
agenda.on('ready', () => {

app.post('/webhook/', function (req, res) {
	var data = req.body;
	console.log(JSON.stringify(data));



	// Make sure this is a page subscription
	if (data.object == 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function (pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function (messagingEvent) {
				if (messagingEvent.optin) {
					receivedAuthentication(messagingEvent);
				} else if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				} else if (messagingEvent.delivery) {
					receivedDeliveryConfirmation(messagingEvent);
				} else if (messagingEvent.postback) {
					receivedPostback(messagingEvent);
				} else if (messagingEvent.read) {
					receivedMessageRead(messagingEvent);
				} else if (messagingEvent.account_linking) {
					receivedAccountLink(messagingEvent);
				} else {
					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
				}
			});
		});

		// Assume all went well.
		// You must send back a 200, within 20 seconds
		res.sendStatus(200);
	}
});





function receivedMessage(event) {

	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;

	if (!sessionIds.has(senderID)) {
		sessionIds.set(senderID, uuid.v1());
	}
	//console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	//console.log(JSON.stringify(message));

	var isEcho = message.is_echo;
	var messageId = message.mid;
	var appId = message.app_id;
	var metadata = message.metadata;

	// You may get a text or attachment but not both
	var messageText = message.text;
	var messageAttachments = message.attachments;
	var quickReply = message.quick_reply;

	if (isEcho) {
		handleEcho(messageId, appId, metadata);
		return;
	} else if (quickReply) {
		handleQuickReply(senderID, quickReply, messageId);
		return;
	}


	if (messageText) {
		//send message to api.ai
		sendToApiAi(senderID, messageText);
	} else if (messageAttachments) {
		handleMessageAttachments(messageAttachments, senderID);
	}
}


function handleMessageAttachments(messageAttachments, senderID){
	//for now just reply
	sendTextMessage(senderID, "Attachment received. Thank you.");
}

function handleQuickReply(senderID, quickReply, messageId) {
	var quickReplyPayload = quickReply.payload;
	console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
	//send payload to api.ai
	sendToApiAi(senderID, quickReplyPayload);
}

//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
	// Just logging message echoes to console
	console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}

let tvshow = "";

function handleApiAiAction(sender, action, responseText, contexts, parameters) {
	switch (action) {
		case "know-a-series" :

			var cont = contexts.map(function(obj) {
					var contextObj = {};
					if(obj.name === "series"){
						tvshow = obj.parameters['tvshow'];
						let intent = 'posters';
						if(obj.parameters['tvshow'] != "")	{
						omdb(sender, intent, tvshow);
						}
						console.log(tvshow + " this is the tv show");
					}
				return contextObj;
			});
			sendTextMessage(sender, responseText);
		break;

		case "actor-search":
      var cont = contexts.map(function(obj) {
        var contextObj = {};
        if(obj.name === "actors"){
          var person = obj.parameters['actor'];
          if(obj.parameters['actors'] != "") {
            personSearch(sender, person);
          }
        }
      });
	  sendTextMessage(sender, responseText);
    break;

    case "show-choices":
      console.log("Napunta sa show-choices");
      sendMovieCards(sender);
    break;

		case "create-reminder":
		console.log("create reminder log");
		var datetime = '';
		var cont = contexts.map(function(obj) {
				var contextObj = {};
				if(obj.name === "remind"){

					if (obj.parameters['datetime'] != "") {
					datetime = obj.parameters['datetime'];
					} else {
					datetime = obj.parameters['time'];
				}
				console.log(datetime + " this is the datetime");

				agenda.now('createReminder', {
				sender,
				datetime: datetime,
				task: "watch movie"
				});

				createReminderAgenda(sender);

				}
			return contextObj;
		});
		sendTextMessage(sender, responseText);

		break;

		default:
			//unhandled action, just send back the text
			sendTextMessage(sender, responseText);
	}
}

function createReminderAgenda(sender){
	return agenda.define('createReminder', job => {
    // Extract fbid, datetime and task from job
    const {sender, datetime, task} = job.attrs.data;

    // Get the FB User's timezone
    getProfile(sender)
      .then(profile => {
        const {first_name, timezone} = profile;
        // Calculating the timezone offset datetime
        const UTC_Offset = moment.utc(datetime).subtract(timezone, 'hours');
        // Calculating the difference between now and the UTC_Offset datetime. If this is
        // 0 or below then we can use the UTC_datetime directly OR else use UTC_Offset
        const timeDiff = UTC_Offset.diff(moment.utc());
        // If timeDiff is 0 or below, then use UTC_datetime or else use UTC_Offset. also convert to date.
        const scheduleTime = (timeDiff <= 0 ? moment.utc(datetime) : UTC_Offset).toDate();
        // Setup the job
        agenda.schedule(scheduleTime, 'reminder', {
          sender,
          first_name,
          task
        });
      })
      .catch(error => console.log(error));
    // Compute an offset from UTC before scheduling the task
  });

}

function getProfile(id) {
		return new Promise((resolve, reject) => {
			request({
				uri: `https://graph.facebook.com/v2.7/` + id,
				qs: {
					access_token: config.FB_PAGE_TOKEN
				},
				method: 'GET'
			}, (error, response, body) => {
				if(!error & response.statusCode === 200) {
					resolve(JSON.parse(body));
				} else {
					reject(error);
				}
			});
		});
	}

var check = false;

function personSearch(sender, person){
  request({
    uri: "https://api.themoviedb.org/3/search/person?api_key=92b2df3080b91d92b31eacb015fc5497",
    qs:{
      query: person,
      page: '1'
    },
    method: "GET"
  }, (error, response, body) => {
    if(!error && response.statusCode === 200){
      createPerson(sender, JSON.parse(body));
    }
  });
}

function createPerson(sender, resultPerson){
  let{
    results: [{
      id
    }]
  } = resultPerson;

  request({
    uri: "https://api.themoviedb.org/3/person/" + id,
    qs:{
      api_key: "92b2df3080b91d92b31eacb015fc5497",
    },
    method: "GET"
  }, (error, response, body) => {
    if(!error && response.statusCode === 200){
      createBiography(sender, JSON.parse(body));
    }
  });
}

function createBiography(sender, bio){
  let{
    name,
    biography,
    profile_path
  } = bio;
  var s = "";
  var imageURL = "http://image.tmdb.org/t/p/w185" + profile_path;
  var biog = [] = biography.split(".");

  let strBiography = `${name},`;
  for(var i = 1; i <= 3; i++){
    s += biog[i] + ".";
  }
  if(s.length > 500){
    s = biog[2] + ".";
  }

  sendImageMessage(sender, imageURL);
  sendTextMessage(sender, strBiography + s);
}

function omdb(sender, intent, tvshow){

if(intent == 'trailerInfo'){
      request({
        uri: "https://www.googleapis.com/customsearch/v1?",
        qs: {
          q: tvshow + " trailer",
          cx: `011868887043149504159:-5-5cnusvca`,
          siteSearch: `https://www.youtube.com/`,
          fields: 'items',
          key: `AIzaSyCOdpES79O2cqWNdxNaLs_6g68cNdWBsWw`,
        },
        method: 'GET'
      }, (error, response, body) => {
        //console.log(response);
        //console.log(JSON.parse(body));
        var items = JSON.parse(body);
        //console.log(JSON.parse(items.pagemap[0]));
        if(!error && response.statusCode === 200){
          (createTrailer(sender, items));
        } else{
          //reject(error);
        }
      });
    }

if(tvshow != null) {
      // Fetch data from OMDB
      request({
        uri: "https://www.omdbapi.com",
        qs: {
          t: tvshow,
          plot: 'short',
          r: 'json',
          apiKey: "270b7488"
        },
        method: 'GET'
      }, (error, response, body) => {
        //console.log(response);
        if(!error && response.statusCode === 200) {
          (createResponse(sender, intent, JSON.parse(body)));
		  check = true;
        } else {

        }
      });
    }
}

function tmdbTVDiscover (sender, genre){
  var genreID = "";
  switch(genre){
    case "action":
      genreID = "10759";
    break;

    case "animation":
      genreID = "16";
    break;

    case "comedy":
      genreID = "35";
    break;

    case "documentary":
      genreID = "99";
    break;

    case "drama":
      genreID = "18";
    break;

    case "family":
      genreID = "10751";
    break;

    case "kids":
      genreID = "10762";
    break;

    case "mystery":
      genreID = "9648"
    break;

    case "reality":
      genreID = "10764";
    break;

    case "science fiction":
      genreID = "10765";
    break;
  }

  var pagenumber = Math.floor(Math.random() * (10 - 1) + 1);

  request({
    uri: "https://api.themoviedb.org/3/discover/tv?api_key=92b2df3080b91d92b31eacb015fc5497",
    qs: {
      language: "en-US",
      sort_by: "popularity.desc",
      page: `${pagenumber}`,
      with_genres: genreID
    },
    method: "GET",
  }, (error, response, body) => {
    if(!error && response.statusCode === 200) {
      createTvList(sender, JSON.parse(body), genre);
    }
  });
}

function tmdbMovieDiscover (sender, genre){
	//Check genre and assign genreID
	var genreID = "";
	switch(genre){

      case "action":
      genreID = "28";
      break;

      case "adventure":
      genreID = "12";
      break;

      case "animation":
      genreID = "16";
      break;

      case "comedy":
      genreID = "35";
      break;

      case "drama":
      genreID = "18";
      break;

      case "horror":
      genreID = "27";
      break;

      case "fantasy":
      genreID = "14";
      break;

      case "music":
      genreID = "10402";
      break;

      case "romance":
      genreID = "10749";
      break;

      case "science fiction":
      genreID = "878";
      break;
	}

	var pagenumber = Math.floor(Math.random() * (10 - 1) + 1);

	request({
		uri: "https://api.themoviedb.org/3/discover/movie?api_key=92b2df3080b91d92b31eacb015fc5497",
		qs: {
			language: "en-US",
			sort_by: "popularity.desc",
			page: `${pagenumber}`,
			with_genres: genreID
		},
		method: "GET",
	}, (error, response, body) => {
		if(!error && response.statusCode === 200) {
			createMovieList(sender, JSON.parse(body), genre);
		}
	});
}

function createTvList(sender, tvList, genre){
  let{
		original_name,
		poster_path
	} = tvList;
	let imagePath = "https://image.tmdb.org/t/p/w500";
	let strTvList = `Here is a list of ${genre} tv shows`;
	let elements = [];
	let buttons = [];
	let button;
	var pagenumber = Math.floor(Math.random() * (5 - 1) + 1);
	let min = 0;
	let max = 0;
if(pagenumber == 1){
	min = 0;
	max = 4;
}else if (pagenumber == 2){
	min = 4;
	max = 8;
}else if (pagenumber == 3){
	min = 8;
	max = 12;
}else if (pagenumber == 4){
	min = 12;
	max = 16;
}else if (pagenumber == 5){
	min = 16;
	max = 20;
}


	for(var i= min; i < max; i++){
      var tvTitle = tvList.results[i].original_name;
			var poster = tvList.results[i].poster_path;
      // strMovieList += movieTitle + '\n';
			imagePath += poster;
			let element = {
				"title": tvTitle,
				"image_url": imagePath,
				"buttons": [
					{
						"type": "postback",
						"title": "Learn More",
						"payload": "card:" + tvTitle
					}
				]
			};
			elements.push(element);
			imagePath = "https://image.tmdb.org/t/p/w500";
  }
	sendTextMessage(sender, strTvList);
	sendGenericMessage(sender, elements);

}

function createMovieList(sender, movieList, genre){
	let{
		title,
		poster_path
	} = movieList;
	let imagePath = "https://image.tmdb.org/t/p/w500";
	let strMovieList = `Here is a list of ${genre} movies`;
	let elements = [];
	let buttons = [];
	let button;
	var pagenumber = Math.floor(Math.random() * (5 - 1) + 1);

	let min = 0;
	let max = 0;
	if(pagenumber == 1){
		min = 0;
		max = 4;
	}else if (pagenumber == 2){
		min = 4;
		max = 8;
	}else if (pagenumber == 3){
		min = 8;
		max = 12;
	}else if (pagenumber == 4){
		min = 12;
		max = 16;
	}else if (pagenumber == 5){
		min = 16;
		max = 20;
	}



	for(var i= min; i < max; i++){
      var movieTitle = movieList.results[i].title;
			var poster = movieList.results[i].poster_path;
      // strMovieList += movieTitle + '\n';
			imagePath += poster;
			let element = {
				"title": movieTitle,
				"image_url": imagePath,
				"buttons": [
					{
						"type": "postback",
						"title": "Learn More",
						"payload": "card:" + movieTitle
					}
				]
			};
			elements.push(element);
			imagePath = "https://image.tmdb.org/t/p/w500";
  }

	sendTextMessage(sender, strMovieList);
	sendGenericMessage(sender, elements);
}
function createResponse (sender, intent, tvshow){

	if(tvshow.Response === 'True') {
    let {
      Title,
      Type,
      Year,
      Plot,
      Director,
      Actors,
      Poster,
      Released,
      Writer,
      totalSeasons
    } = tvshow;

    switch(intent) {
      case 'tvInfo' : {
        let str = `${Title} (${Year}). This film was directed by ${Director} and starred ${Actors}. ${Plot}`;
        sendTextMessage(sender, str);
				sendImageMessage(sender, Poster);

      }

		  case 'posters':
				sendImageMessage(sender, Poster);
        setTimeout(function(){
				      sendMovieCards(sender);
        },3000);
			break;

		  case 'plot':
				let strPlot = `${Plot}`;
				setTimeout(function(){
				      moviequickreply(sender, strPlot);
        },2000);
			break;

    	case 'director':
				let strDirector = `${Title} was directed by ${Director} and written by ${Writer}`;
        setTimeout(function(){
				      moviequickreply(sender, strDirector);
        },2000);
		//setTimeout(function(){
					  knowDirector(sender, Director);
		//			  },3000);
			break;

      case 'cast':
				let strCast = `${Title} stars ${Actors}`;
        setTimeout(function(){
				      moviequickreply(sender, strCast);
        },2000);
			break;

      case 'releaseyear':
				let strRelease = `${Title} was released on ${Released}`;
        setTimeout(function(){
				      moviequickreply(sender, strRelease);
        },2000);
			break;

      case 'numberOfSeasons': {
        if(Type == 'movie'){
          let str = `${Title} is not a TV Series. Please try again.`;
          return{
            text: str,
            image: null
          }
        }
        else if(Type == 'series'){
          let str = `${Title} currently has ${totalSeasons} season(s).`;
          return{
            text: str,
            image: null
          }
        }
      }

    }
  }else{
    let str = `I'm still learning, please re-type if you have a typo`;
          sendTextMessage(sender, str);
  }
}

function createTrailer (sender, trailer) {
  if(trailer){
    console.log("Umabot ng trailer");
    let{
        items:[{
          title,
          link,
          snippet,
          pagemap: {
            cse_thumbnail: [{
              src
            }]
          }
        }]
    } = trailer;

    let elements = [];
    let buttons = [];
    let button;
    button = {
					"type": "web_url",
					"title": "Watch trailer",
					"url": link
				}
    buttons.push(button);
    let element = {
			"title": title,
			"image_url": src,
			"subtitle": snippet,
			"buttons": buttons
		};
		elements.push(element);

    sendGenericMessage(sender, elements);
  }
  else{
    return{
      text: "I'm sorry, there must be an error. Please try again.",
      image: null
    }
  }
}

function sendMovieCards(sender){

		request({
			uri: 'https://graph.facebook.com/v2.7/' + sender,
			qs: {
				access_token: config.FB_PAGE_TOKEN
			}
		}, function(error, response, body) {
			if(!error && response.statusCode == 200){
				var user = JSON.parse(body);

				if(user.first_name){
					console.log("FB user: %s %s, %s",
						user.first_name, user.last_name, user.gender);

					let elements = [
						{
							"title": "Know about the Plot",
							"image_url": "http://i.imgur.com/DFSanrI.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Plot",
									"payload": "aboutplot"
								}
							]
						},
						{
							"title": "Know the Director",
							"image_url": "http://i.imgur.com/HWpIyNx.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Director",
									"payload": "aboutdirector"
								}
							]
						},
						{
							"title": "Know the Cast",
							"image_url": "http://i.imgur.com/2UxrgcT.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Cast",
									"payload": "aboutcast"
								}
							]
						},
						{
							"title": "Know the Release Year",
							"image_url": "http://i.imgur.com/Gbd4YFV.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Release Year",
									"payload": "aboutreleaseyear"
								}
							]
						},
						{
							"title": "Watch the trailer",
							"image_url": "http://i.imgur.com/9pE8MRL.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Trailer",
									"payload": "abouttrailer"
								}
							]
						},
            {
							"title": "Search Again",
							"image_url": "http://i.imgur.com/FEmuU4p.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Search Again",
									"payload": "searchAgain"
								}
							]
						}
					];
					sendGenericMessage(sender, elements);
				}
				else{
					console.log("Cannot get data for fb user with id",
						sender);
				}
			}
			else{
				console.error(response.error);
			}
		});

}


function knowDirector(sender, Director){
console.log("i was at director know");
	request({
        uri: "https://www.googleapis.com/customsearch/v1?",
        qs: {
          q: Director,
          cx: `011868887043149504159:-5-5cnusvca`,
          siteSearch: `https://www.imdb.com/`,
          fields: 'items',
          key: `AIzaSyCOdpES79O2cqWNdxNaLs_6g68cNdWBsWw`,
        },
        method: 'GET'
      }, (error, response, body) => {
        //console.log(response);
        //console.log(JSON.parse(body));
        var items = JSON.parse(body);
        //console.log(JSON.parse(items.pagemap[0]));
        if(!error && response.statusCode === 200){
          (createResponseDirector(sender, items));
        } else{
          //reject(error);
        }
      });
}

function createResponseDirector(sender, director){
	if(director){
    console.log("Umabot ng director");
    let{
        items:[{          
			link,
			pagemap: {				
				person: [{
					image,
					name,
					description,
					awards
				}]
			}          
        }]
    } = director;

   	let elements = [];
    let buttons = [];
    let button;
    button = {
					"type": "web_url",
					"title": "View profile",
					"url": link
				}
    buttons.push(button);
    let element = {
			"title": name,
			"image_url": image,
			"subtitle": description,
			"buttons": buttons
		};
		elements.push(element);

    sendGenericMessage(sender, elements);
  }
  else{
    return{
      text: "I'm sorry, there must be an error. Please try again.",
      image: null
    }
  }


}

function moviequickreply(sender, text){
var txtmessage = "";
request({
		uri: 'https://graph.facebook.com/v2.7/' + sender,
		qs: {
			access_token: config.FB_PAGE_TOKEN
		}

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {

			var user = JSON.parse(body);


			if (user.first_name) {
				console.log("FB user: %s %s, %s",
					user.first_name, user.last_name, user.gender);

				txtmessage = text;
				let replies = [
		{
			"content_type": "text",
			"title": "Show Choices",
			"payload":"Show Choices"
		},
		{
			"content_type": "text",
			"title": "Find Another",
			"payload":"Find Another"

		}

		];
		sendQuickReply(sender, txtmessage, replies);
			} else {
				console.log("Cannot get data for fb user with id",
					sender);
			}
		} else {
			console.error(response.error);
		}

	});


}



function handleMessage(message, sender) {
	switch (message.type) {
		case 0: //text
			sendTextMessage(sender, message.speech);
			break;
		case 2: //quick replies
			let replies = [];
			for (var b = 0; b < message.replies.length; b++) {
				let reply =
				{
					"content_type": "text",
					"title": message.replies[b],
					"payload": message.replies[b]
				}
				replies.push(reply);
			}
			sendQuickReply(sender, message.title, replies);
			break;
		case 3: //image
			sendImageMessage(sender, message.imageUrl);
			break;
		case 4:
			// custom payload
			var messageData = {
				recipient: {
					id: sender
				},
				message: message.payload.facebook

			};

			callSendAPI(messageData);

			break;
	}
}


function handleCardMessages(messages, sender) {

	let elements = [];
	for (var m = 0; m < messages.length; m++) {
		let message = messages[m];
		let buttons = [];
		for (var b = 0; b < message.buttons.length; b++) {
			let isLink = (message.buttons[b].postback.substring(0, 4) === 'http');
			let button;
			if (isLink) {
				button = {
					"type": "web_url",
					"title": message.buttons[b].text,
					"url": message.buttons[b].postback
				}
			} else {
				button = {
					"type": "postback",
					"title": message.buttons[b].text,
					"payload": message.buttons[b].postback
				}
			}
			buttons.push(button);
		}


		let element = {
			"title": message.title,
			"image_url":message.imageUrl,
			"subtitle": message.subtitle,
			"buttons": buttons
		};
		elements.push(element);
	}
	sendGenericMessage(sender, elements);
}


function handleApiAiResponse(sender, response) {
	let responseText = response.result.fulfillment.speech;
	let responseData = response.result.fulfillment.data;
	let messages = response.result.fulfillment.messages;
	let action = response.result.action;
	let contexts = response.result.contexts;
	let parameters = response.result.parameters;

	sendTypingOff(sender);

	if (isDefined(messages) && (messages.length == 1 && messages[0].type != 0 || messages.length > 1)) {
		let timeoutInterval = 1100;
		let previousType ;
		let cardTypes = [];
		let timeout = 0;
		for (var i = 0; i < messages.length; i++) {

			if ( previousType == 1 && (messages[i].type != 1 || i == messages.length - 1)) {

				timeout = (i - 1) * timeoutInterval;
				setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
				cardTypes = [];
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			} else if ( messages[i].type == 1 && i == messages.length - 1) {
				cardTypes.push(messages[i]);
                		timeout = (i - 1) * timeoutInterval;
                		setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
                		cardTypes = [];
			} else if ( messages[i].type == 1 ) {
				cardTypes.push(messages[i]);
			} else {
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			}

			previousType = messages[i].type;

		}
	} else if (responseText == '' && !isDefined(action)) {
		//api ai could not evaluate input.
		console.log('Unknown query' + response.result.resolvedQuery);
		sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
	} else if (isDefined(action)) {
		handleApiAiAction(sender, action, responseText, contexts, parameters);
	} else if (isDefined(responseData) && isDefined(responseData.facebook)) {
		try {
			console.log('Response as formatted message' + responseData.facebook);
			sendTextMessage(sender, responseData.facebook);
		} catch (err) {
			sendTextMessage(sender, err.message);
		}
	} else if (isDefined(responseText)) {

		sendTextMessage(sender, responseText);
	}
}

function sendToApiAi(sender, text) {

	sendTypingOn(sender);
	let apiaiRequest = apiAiService.textRequest(text, {
		sessionId: sender
	});

	apiaiRequest.on('response', (response) => {
		if (isDefined(response.result)) {
			handleApiAiResponse(sender, response);
		}
	});

	apiaiRequest.on('error', (error) => console.error(error));
	apiaiRequest.end();
}




function sendTextMessage(recipientId, text) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text
		}
	}
	callSendAPI(messageData);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, imageUrl) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: imageUrl
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: config.SERVER_URL + "/assets/instagram_logo.gif"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "audio",
				payload: {
					url: config.SERVER_URL + "/assets/sample.mp3"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example videoName: "/assets/allofus480.mov"
 */
function sendVideoMessage(recipientId, videoName) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "video",
				payload: {
					url: config.SERVER_URL + videoName
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example fileName: fileName"/assets/test.txt"
 */
function sendFileMessage(recipientId, fileName) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "file",
				payload: {
					url: config.SERVER_URL + fileName
				}
			}
		}
	};

	callSendAPI(messageData);
}



/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId, text, buttons) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: text,
					buttons: buttons
				}
			}
		}
	};

	callSendAPI(messageData);
}

function btn(id, data) {
	console.log("im at here");
		let obj = {
			recipient: {
				id
			},
			message: {
				attachment: {
					type: 'template',
					payload: {
						template_type: 'button',
						text: data.text,
						buttons: data.buttons
					}
				}
			}
		}

		this.sendMessage(obj)
			.catch(error => console.log(error));
	}


function sendGenericMessage(recipientId, elements) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "generic",
					elements: elements
				}
			}
		}
	};

	callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
							timestamp, elements, address, summary, adjustments) {
	// Generate a random receipt ID as the API requires a unique ID
	var receiptId = "order" + Math.floor(Math.random() * 1000);

	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "receipt",
					recipient_name: recipient_name,
					order_number: receiptId,
					currency: currency,
					payment_method: payment_method,
					timestamp: timestamp,
					elements: elements,
					address: address,
					summary: summary,
					adjustments: adjustments
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, text, replies, metadata) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text,
			metadata: isDefined(metadata)?metadata:'',
			quick_replies: replies
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {

	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "mark_seen"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_on"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_off"
	};

	callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: "Welcome. Link your account.",
					buttons: [{
						type: "account_link",
						url: config.SERVER_URL + "/authorize"
          }]
				}
			}
		}
	};

	callSendAPI(messageData);
}


function greetUserText(userId) {
	//first read user firstname
	request({
		uri: 'https://graph.facebook.com/v2.7/' + userId,
		qs: {
			access_token: config.FB_PAGE_TOKEN
		}

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {

			var user = JSON.parse(body);

			if (user.first_name) {
				console.log("FB user: %s %s, %s",
					user.first_name, user.last_name, user.gender);

				sendTextMessage(userId, "Welcome " + user.first_name + '!');
			} else {
				console.log("Cannot get data for fb user with id",
					userId);
			}
		} else {
			console.error(response.error);
		}

	});
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: {
			access_token: config.FB_PAGE_TOKEN
		},
		method: 'POST',
		json: messageData

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var recipientId = body.recipient_id;
			var messageId = body.message_id;

			if (messageId) {
				console.log("Successfully sent message with id %s to recipient %s",
					messageId, recipientId);
			} else {
				console.log("Successfully called Send API for recipient %s",
					recipientId);
			}
		} else {
			console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
		}
	});
}



/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */

let senderd = '';
function receivedPostback(event) {
	var senderID = event.sender.id;
	senderd = senderID;
	var recipientID = event.recipient.id;
	var timeOfPostback = event.timestamp;

	// The 'payload' param is a developer-defined field which is set in a postback
	// button for Structured Messages.
	var payload = event.postback.payload;

  if(payload.includes("card")){
    let recTitle = payload.split(":")[1];
    tvshow = recTitle;
    let intents = "posters";
    payload = "card";
    omdb(senderID, intents, tvshow);
  }

	switch (payload) {
		case "FACEBOOK_WELCOME":
			sendToApiAi(senderID, "Get Started");
		break;

    case "searchAgain":
      sendToApiAi(senderID, "Find Another");
    break;

    case "Show Choices":
      sendToApiAi(senderID, "Show Choices");
    break;

    case "recommendGenre":
      sendToApiAi(senderID, "Recommend Genre");
    break;

    case "recommendYear":
    console.log("Napunta sa Recommend Year");
      sendToApiAi(senderID, "Recommend Year");
    break;

		case "getStarted":
			sendToApiAi(senderID, "Get Started");
		break;

    case "showSearch":
      sendToApiAi(senderID, "Know About A Series");
    break;

    case "recommend":
      sendToApiAi(senderID, "Recommend Me");
    break;

    case "actorSearch":
      sendToApiAi(senderID, "Actor");
    break;
		case "aboutplot":
			var intents = "plot";
			omdb(senderID, intents, tvshow);
		break;

		case "aboutdirector":
			var intents = 'director';
			omdb(senderID, intents, tvshow);
		break;

		case "aboutcast":
			var intents = 'cast';
			omdb(senderID, intents, tvshow);
		break;

		case "aboutreleaseyear":
			var intents = "releaseyear";
			omdb(senderID, intents, tvshow);
		break;

		case "abouttrailer" :
			var intents = "trailerInfo";
			omdb(senderID, intents, tvshow);
		break;

		case "watchlist" :

		let sender = senderID;
      	agenda.now('showReminders', {
        sender: sender
      	});

		showReminders(senderID);

		break;

    case "recommendMovie":
      sendToApiAi(senderID, "recommendMovie");
    break;

    case "recommendTV":
      sendToApiAi(senderID, "recommendTV");
    break;

		case "movieAction":
			var genre = "action";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieAdventure":
			var genre = "adventure";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieAnimation":
			var genre = "animation";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieComedy":
			var genre = "comedy";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieDrama":
			var genre = "drama";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieFantasy":
			var genre = "fantasy";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieHorror":
			var genre = "horror";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieMusic":
			var genre = "music";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieRomance":
			var genre = "romance";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieSciFi":
			var genre = "science fiction";
			tmdbMovieDiscover(senderID, genre);
		break;

    case "tvAction":
      var genre = "action";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvAnimation":
      var genre = "animation";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvComedy":
      var genre = "comedy";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvDocumentary":
      var genre = "documentary";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvDrama":
      var genre = "drama";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvFamily":
      var genre = "family";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvKids":
      var genre = "kids";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvMystery":
      var genre = "mystery";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvReality":
      var genre = "reality";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvSciFi":
      var genre = "science fiction";
      tmdbTVDiscover(senderID, genre);
    break;

    case "card":
      console.log("pumasok ng card case");
    break;

		default:
			//unindentified payload
			sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
			break;

	}

	console.log("Received postback for user %d and page %d with payload '%s' " +
		"at %d", senderID, recipientID, payload, timeOfPostback);

}


 function showReminders(senderID){
	console.log("Im at show reminders");
	return agenda.define('showReminders', job => {
    let {sender} = job.attrs.data;
    agenda.jobs({
      name: 'reminder',
      'data.sender': sender,
      'nextRunAt': {
        $exists: true,
        $ne: null
      }
    }, (error, data) => {
      if(data.length === 0) {
        sendTextMessage(sender, "You've got no reminders set! Yay! :)");
      } else {
        data.forEach(item => {
          // Loop over and display each reminder
          let {_id, nextRunAt} = item.attrs;
          let {task} = item.attrs.data;

          let rightNowUTC = moment.utc();
          let runDate = moment.utc(nextRunAt);
          let timeToEvent = rightNowUTC.to(runDate);

          let data = {
            text: `${task ? task.charAt(0).toUpperCase() + task.slice(1) : 'Something'} is due ${timeToEvent}`,
            buttons: [{
              type: 'postback',
              title: 'Cancel Reminder',
              payload: `{
                "schedule": "cancelReminder",
                "sender": "${sender}",
                "id": "${_id}"
              }`
            }]
          }
		  console.log(JSON.stringify(data) + "This is the data");
          btn(senderID, data);

        });
      }
    });
  });

 }

  agenda.define('reminder', job => {
    const {senderd, first_name, task} = job.attrs.data;
    sendTextMessage(senderd, `Hey ${first_name}! Reminding you to ${task}!`);
  });

  function cancelReminder(sender){

  return agenda.define('cancelReminder', job => {
    const {sender, id} = job.attrs.data;
    agenda.cancel({
      name: 'reminder',
      _id: new ObjectID(id)
    }, (error, numRemoved) => {
      if(!error) {
        sendTextMessage(sender, (numRemoved > 0 ? "Alright. I've canceled the reminder." : "I've already canceled this reminder. Don't worry, it won't bother you. :)"));
      } else {
        sendTextMessage(sender, "Uh Oh! Something's not right with our servers. Could you try again after a while?");
      }
    });
  });
  }

/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	// All messages before watermark (a timestamp) or sequence have been seen.
	var watermark = event.read.watermark;
	var sequenceNumber = event.read.seq;

	console.log("Received message read event for watermark %d and sequence " +
		"number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 *
 */
function receivedAccountLink(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	var status = event.account_linking.status;
	var authCode = event.account_linking.authorization_code;

	console.log("Received account link event with for user %d with status %s " +
		"and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var delivery = event.delivery;
	var messageIDs = delivery.mids;
	var watermark = delivery.watermark;
	var sequenceNumber = delivery.seq;

	if (messageIDs) {
		messageIDs.forEach(function (messageID) {
			console.log("Received delivery confirmation for message ID: %s",
				messageID);
		});
	}

	console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfAuth = event.timestamp;

	// The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
	// The developer can set this to an arbitrary value to associate the
	// authentication callback with the 'Send to Messenger' click event. This is
	// a way to do account linking when the user clicks the 'Send to Messenger'
	// plugin.
	var passThroughParam = event.optin.ref;

	console.log("Received authentication for user %d and page %d with pass " +
		"through param '%s' at %d", senderID, recipientID, passThroughParam,
		timeOfAuth);

	// When an authentication is received, we'll send a message back to the sender
	// to let them know it was successful.
	sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
});
function verifyRequestSignature(req, res, buf) {
	var signature = req.headers["x-hub-signature"];

	if (!signature) {
		throw new Error('Couldn\'t validate the signature.');
	} else {
		var elements = signature.split('=');
		var method = elements[0];
		var signatureHash = elements[1];

		var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
			.update(buf)
			.digest('hex');

		if (signatureHash != expectedHash) {
			throw new Error("Couldn't validate the request signature.");
		}
	}
}

function isDefined(obj) {
	if (typeof obj == 'undefined') {
		return false;
	}

	if (!obj) {
		return false;
	}

	return obj != null;
}



// Spin up the server
app.listen(app.get('port'), function () {
	console.log('running on port', app.get('port'))
})
