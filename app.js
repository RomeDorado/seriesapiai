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
const mongoose = require('mongoose');
const db = mongoose.connect(process.env.MONGO_URI);
const Movie = require("./movieModel");


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

var tvshow = "";
var category = "";
var imagePath = "";
var year = "";
var genre = "";
var task = "watch movie";
var responseText = "";

function handleApiAiAction(sender, action, responseText, contexts, parameters) {
	switch (action) {
		case "input.unknown" :
		var textArray = [
    `I wasn't originally going to get a brain transplant, but then I changed my mind. 😏`,
    `I would like tell you a chemistry joke at this point, but I know I wouldn't get a reaction. 😓`,
		`Have you ever tried to eat a clock? It's very time consuming. ⏱`,
		`I'm reading a book about anti-gravity. It's impossible to put down. 📕`,
		`Why don't programmers like nature? It has too many bugs. 🐜`,
		`You know, I don't trust these stairs because they're always up to something. 🤔`
			];
		var random = Math.floor(Math.random()*textArray.length);
		sendTextMessage(sender, textArray[random]);
		let str = `But series-ly though, I didn't quite understand that. You might wanna access the menu if you are lost, or head back to the main menu, alright?`;
		consufedquickreply(sender, str);
		break;
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
    console.log("Napunta sa actor-search");
      var cont = contexts.map(function(obj) {
        var contextObj = {};
        if(obj.name === "actor-intent"){
          var person = obj.parameters['actor'];
          if(obj.parameters['actor'] != "") {
            personSearch(sender, person);
          }
        }
      });
	  sendTextMessage(sender, responseText);
    break;

    case "recommend-year":
      console.log("Napunta sa recommend-year");
      var cont = contexts.map(function (obj) {
        var contextObj = {};
        if(obj.name === "movie-year"){
          year = obj.parameters['year'];
          if(obj.parameters['year'] != ""){
            console.log("tama ang if statement sa yearsearch");
            yearSearch(sender, year);
          }
        }
      });
    sendTextMessage(sender, responseText);
    break;

    case "show-choices":
      console.log("Napunta sa show-choices");
      sendMovieCards(sender);
    break;

		case "show-choices-genre":
			sendMovieCardsGenre(sender);
		break;

		case "show-choices-year":
		sendMovieCardsYear(sender);
		break;

		case "show-choices-tv":
		sendMovieCardsTv(sender);
		break;
	
		default:
			//unhandled action, just send back the text
			sendTextMessage(sender, responseText);
	}
}



var check = false;

function yearSearch(sender, year){
  console.log("Pumasok sa yearSearch");
  var pagenumber = Math.floor(Math.random() * (12 - 1) + 1);
  request({
    uri: "https://api.themoviedb.org/3/discover/movie?api_key=92b2df3080b91d92b31eacb015fc5497",
    qs: {
      language: "en-US",
      sort_by: "popularity.desc",
      page: `${pagenumber}`,
      primary_release_year: year
    },
    method: "GET"
  }, (error, response, body) => {
    if(!error && response.statusCode === 200){
      createYearList(sender, JSON.parse(body), year);
    }
  });
}

function personSearch(sender, person){
  request({
    uri: "https://api.themoviedb.org/3/search/person?api_key=92b2df3080b91d92b31eacb015fc5497",
    qs:{
      query: person,
      page: '1'
    },
    method: "GET"
  }, (error, response, body) => {
		var per = JSON.parse(body);
    if(!error && response.statusCode === 200 && per.total_results != 0){
      createPerson(sender, JSON.parse(body));
    }else{
			sendTextMessage(sender, "I can't seem to find the person you are looking for. Please try again.");
				Actorcards(sender);
		}
  });
}

function createPerson(sender, resultPerson){
		if(resultPerson != undefined || null){
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
					console.log(response);
					createBiography(sender, JSON.parse(body));
				}
			});
		}else{
			let text = `I can't seem to find that actor/actress please re-type if you have a typo`;
			actorerrorquickreply(sender, text);
		}
	}

function createBiography(sender, bio){
  let{
    name,
    biography,
	imdb_id,
    profile_path
  } = bio;
	if (biography == null){
		let str = "Oh no! I can't seem to find that actor/actress 😖";
		consufedquickreply(sender, str);
	}else{
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


  let elements = [];
    let buttons = [];
    let button;
    button = {
					"type": "web_url",
					"title": "Know more",
					"url": `www.imdb.com/name/${imdb_id}/bio?=ref_nm_ov_bio_sm`
				}
    buttons.push(button);

		let button1 = {

                "type":"postback",
                "title":"Find another actor",
								"payload":"actorSearch"
              }
		buttons.push(button1);

		let button2 = {
								"type":"postback",
                "title":"Back to Main Menu",
                "payload":"searchAgain"
				}
    buttons.push(button2);





    let element = {
			"title": name,
			"image_url": imageURL,
			"subtitle": `Want to know more about ${name}?`,
			"buttons": buttons
		};
		elements.push(element);

	sendTextMessage(sender, strBiography + s);
    sendGenericMessage(sender, elements);
	//let option = "Select other options";
  //sendImageMessage(sender, imageURL);

}
}

function omdb(sender, intent, tvshow, category){
	console.log(category + "This is the category");
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
          plot: 'full',
          r: 'json',
          apiKey: "270b7488"
        },
        method: 'GET'
      }, (error, response, body) => {
        console.log(response);
        if(!error && response.statusCode === 200) {
          (createResponse(sender, intent, JSON.parse(body), category));
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
	imagePath = "https://image.tmdb.org/t/p/w500";
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
						"payload": "card/" + tvTitle + "/tv"
					}
				]
			};
			elements.push(element);
			imagePath = "https://image.tmdb.org/t/p/w500";
  }

			let ele = {
								"title": "Select Other Genres",
								"image_url": 'http://i.imgur.com/TZ2LGfo.png',
								"buttons": [
									{
										"type": "postback",
										"title": "Other genres",
										"payload": "recommendTV"
									}
								]
							};
				elements.push(ele);

					let eleme = {
								"title": `View More ${genre} TV Series`,
								"image_url": 'http://i.imgur.com/vfj4Qlu.png',
								"buttons": [
									{
										"type": "postback",
										"title": "More",
										"payload": "moregenretv"
									}
								]
							}
							elements.push(eleme);

				let elem = {
								"title": "Back to Recommendation Menu",
								"image_url": 'http://i.imgur.com/tPICPoU.png',
								"buttons": [
									{
										"type": "postback",
										"title": "Recommendation menu",
										"payload": "recommend"
									}
								]
							}


				elements.push(elem);
	sendTextMessage(sender, strTvList);
	sendGenericMessage(sender, elements);

}

function tmdbUpcoming(senderID){
  request({
		uri: "http://api.themoviedb.org/3/movie/upcoming?api_key=92b2df3080b91d92b31eacb015fc5497",
		method: "GET",
	}, (error, response, body) => {
		if(!error && response.statusCode === 200) {
			createUpcomingList(senderID, JSON.parse(body));
		}
	});
}

function createUpcomingList(senderID, upcomingList){
  let{
    title,
    poster_path
  } = upcomingList;
  imagePath = "https://image.tmdb.org/t/p/w500";
  let elements = [];
  let buttons = [];
  let button;

  for(var i = 0; i < 9; i++){
    var upTitle = upcomingList.results[i].title;
    var upPoster = upcomingList.results[i].poster_path;
    imagePath += upPoster;

    let element = {
      "title": upTitle,
      "image_url": imagePath,
      "buttons": [
        {
          "type": "postback",
          "title": "Learn More",
          "payload": "card/" + upTitle
        }
      ]
    };
    elements.push(element);
    imagePath = "https://image.tmdb.org/t/p/w500";
  }
  sendGenericMessage(senderID, elements);
	moviequickreply(senderID);
}

function createYearList(sender, yearList, year){
  let{
      title,
      poster_path
  } = yearList;
  imagePath = "https://image.tmdb.org/t/p/w500";
  let strYearList = `Here is a list of movies from ${year}`;
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
      var movieTitle = yearList.results[i].title;
			var poster = yearList.results[i].poster_path;
      // strMovieList += movieTitle + '\n';
			imagePath += poster;
			let element = {
				"title": movieTitle,
				"image_url": imagePath,
				"buttons": [
					{
						"type": "postback",
						"title": "Learn More",
						"payload": "card/" + movieTitle + "/year"
					}
				]
			};
			elements.push(element);
			imagePath = "https://image.tmdb.org/t/p/w500";
  }

			let ele = {
								"title": `View More Movies From Year ${year}`,
								"image_url": 'http://i.imgur.com/vfj4Qlu.png',
								"buttons": [
									{
										"type": "postback",
										"title": "More",
										"payload": "moreyear"
									}
								]
							}
				elements.push(ele);

				let elem = {
								"title": "Back to Recommendation Menu",
								"image_url": 'http://i.imgur.com/tPICPoU.png',
								"buttons": [
									{
										"type": "postback",
										"title": "Recommendation menu",
										"payload": "recommend"
									}
								]
							}


				elements.push(elem);
				sendTextMessage(sender, strYearList);
		sendGenericMessage(sender, elements);
		}

function createMovieList(sender, movieList, genre){
	let{
		title,
		poster_path
	} = movieList;
	imagePath = "https://image.tmdb.org/t/p/w500";
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
						"payload": "card/" + movieTitle + "/genre"
					}
				]
			};
			elements.push(element);
			imagePath = "https://image.tmdb.org/t/p/w500";
  }

			let ele = {
								"title": "Select Other Genres",
								"image_url": 'http://i.imgur.com/TZ2LGfo.png',
								"buttons": [
									{
										"type": "postback",
										"title": "Other genres",
										"payload": "recommendGenre"
									}
								]
							};
				elements.push(ele);

					let eleme = {
								"title": `View More ${genre} Movies`,
								"image_url": 'http://i.imgur.com/vfj4Qlu.png',
								"buttons": [
									{
										"type": "postback",
										"title": "More",
										"payload": "moregenre"
									}
								]
							}
							elements.push(eleme);

				let elem = {
								"title": "Back to Recommendation Menu",
								"image_url": 'http://i.imgur.com/tPICPoU.png',
								"buttons": [
									{
										"type": "postback",
										"title": "Recommendation menu",
										"payload": "recommend"
									}
								]
							}


				elements.push(elem);

	sendTextMessage(sender, strMovieList);

		var messageData = {
				recipient: {
					id: sender
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





var firstname = "";
function addToFavorites(senderID, tvshow, imagePath, category){

request({
		uri: 'https://graph.facebook.com/v2.7/' + senderID,
		qs: {
			access_token: config.FB_PAGE_TOKEN
		}

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {

			var user = JSON.parse(body);

			if (user.first_name) {
				console.log("FB user: %s %s, %s",
					user.first_name, user.last_name, user.gender);					
				//sendTextMessage(userId, "Welcome " + user.first_name + '!');
			



  var addMovie = new Movie({
    user_id: senderID,
    title: tvshow.toLowerCase(),
    poster: imagePath
  });
  let strFavorites = "";

  Movie.count({user_id: senderID}, function(err, count) {
    console.log("Number of docs: " + count);
    if(count > 9){
      strFavorites = "The sky is the limit! ☁️";
      sendTextMessage(senderID, strFavorites);	
			let str1 = "But when adding favorites, your limit is at 10"	
			setTimeout(function() {
			sendTextMessage(senderID, str1);	
			}, 1000);								
			let str2 = `Sorry about that ${user.first_name} 😖`;	
			setTimeout(function() {
			sendTextMessage(senderID, str2);	
			}, 1200);
			setTimeout(function() {
			moviequickreply(senderID);	
			}, 1500);
				

    }
    else{
      Movie.count({user_id: senderID, title: tvshow}, function(err, ctr){
        if(ctr == 1){
					let tvshow1 = tvshow.replace(/\w\S*/g, function(txt){
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});
          strFavorites = `Hey ${user.first_name}! ${tvshow1} is already in your list ✋`;
          sendTextMessage(senderID, strFavorites);
						moviequickreply(senderID);

        }
        else{
          addMovie.save(function (err){
            if(err){
              console.log("Database error: " + err);
            }
            else{
              strFavorites = "Hoorah! We've added this to your Favorites! You can see your favorites list on the menu 🤙";

          sendTextMessage(senderID, strFavorites);
    		  moviequickreply(senderID, category);
            }
          });
        }
      });
    }
  });

} else {
				console.log("Cannot get data for fb user with id",
					userId);
			}
		} else {
			console.error(response.error);
		}

	});

}

function getFavorites(senderID){
  Movie.count({user_id: senderID}, function(err, count){
    if(count === 0){
      let strFav = "I gave you everything, but you left me with nothing 😭";
      sendTextMessage(senderID, strFav);
			let str2 = "I got carried away again, sorry about that";
			setTimeout(function() {
			sendTextMessage(senderID, str2);	
		}, 1000);
			let str3 = "You have nothing to see here! It's as empty as my wallet 💸"			
			setTimeout(function() {
			sendTextMessage(senderID, str3);		
			}, 1500);			
			setTimeout(function() {
			moviequickreplyfave(senderID);	
			}, 2000);
      
    }
    else{
      Movie.find({user_id: senderID}, function(err, favList){
        var favMap = {};
        let elements = [];
      	let buttons = [];
      	let button;
        let strFav = "Here are a list of your favorite movie and tv shows: ";


        for(var ctr = 0; ctr < favList.length; ctr++){
          var favTitle = favList[ctr].title;
          var favPoster = favList[ctr].poster;

          favTitle = favTitle.replace(/\w\S*/g, function(txt){
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});

          let element = {
            "title": favTitle,
            "image_url": favPoster,
            "buttons": [
              {
                "type": "postback",
                "title": "Learn More",
                "payload": "card/" + favTitle
              },
              {
                "type": "postback",
                "title": "Remove from Favorites",
                "payload": "remove/" + favTitle
              }
            ]
          };
          elements.push(element);
        }
        sendTextMessage(senderID, strFav);
        sendGenericMessage(senderID, elements);
        console.log("Success and Favorites");

      });
    }
  })
}

function removeFavorites(senderID, tvshow){
  var strRemove = "";
  Movie.remove({user_id: senderID, title: tvshow.toLowerCase()}, function(err){
    if(err){
      strRemove = "I'm sorry there seems to be an error connecting to the database. Please try again later.";
      sendTextMessage(senderID, strRemove);
    }
    else{
      strRemove = `Successfully removed ${tvshow} from your favorites list.`;
      sendTextMessage(senderID, strRemove);
			moviequickreplyfave(senderID);
    }
  })
}

function createResponse (sender, intent, tvshow, category){

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
      totalSeasons,
			imdbRating
    } = tvshow;
    imagePath = Poster;

    switch(intent) {
      case 'tvInfo' : {
        let str = `${Title} (${Year}). This film was directed by ${Director} and starred ${Actors}. ${Plot}`;
        sendTextMessage(sender, str);
				sendImageMessage(sender, Poster);

      }

		  case 'posters':

				sendImageMessage(sender, Poster);
				if(category == "genre"){
					setTimeout(function(){
				      sendMovieCardsGenre(sender);
        },2000);
				}else if (category == "year"){
					setTimeout(function(){
				      sendMovieCardsYear(sender);
        },2000);
				}else if (category == "tv"){
					setTimeout(function(){
				      sendMovieCardsTv(sender);
        },2000);
				}else{
						setTimeout(function(){
				      sendMovieCards(sender);
        },2000);
				}
			break;

		  case 'plot':
		  	var s1 ='';
				var checker = true;
				var s2 ='';
				let strPlot = `${Plot}`;
				var longPlot = [] = Plot.split(".");

				for (var i=0; i <= 2; i++){
				if (longPlot[i] == undefined){
					longPlot[i] = "";
				}
				s1 += longPlot[i] + ".";
			}
				if(longPlot.length > 3){
				for (var i=3; i <= 7; i++){
				if (longPlot[i] == undefined){
					longPlot[i] = "";
				}else{
				s2 += longPlot[i] + ".";
				checker = false;
				}
			}
		}else{
			checker = true;
		}

		if(checker == true){
			console.log(category + " at moviequickreply")
			sendTextMessage(sender, s1);
			moviequickreply(sender, category);
		}else{
			sendTextMessage(sender, s1);
			setTimeout(function() {
			sendTextMessage(sender, s2);	
			}, 1000);
			setTimeout(function() {
			moviequickreply(sender, category);	
			}, 2000);
				

}				//if(checker == true){

				//}

			break;

    	case 'director':
				if(Director == "N/A" && Writer == "N/A"){
				let strDirector1 = `Sorry, it seems like the director(s) and writer(s) of ${Title} is not registered in our database`;	
				sendTextMessage(sender, strDirector1);
				moviequickreply(sender, category);
				}else if(Director == "N/A" && Writer != "N/A"){
				let strDirector1 = `Sorry we couldn't identify who directed ${Title}, but it is written by ${Writer}`;
						sendTextMessage(sender, strDirector1);
				    moviequickreply(sender, category);
				} else {
			    let strDirector2 = `${Title} was directed by ${Director} and written by ${Writer}`;
				 knowDirector(sender, Director);
				 	setTimeout(function(){
						 sendTextMessage(sender, strDirector2);
        	},2000);
					setTimeout(function(){
					moviequickreply(sender, category);
					},2000);
				}

			break;

      case 'cast':
				let strCast = `${Title} stars ${Actors}`;
				sendTextMessage(sender, strCast);
				knowfullcast (sender, Title);				
			break;

      case 'releaseyear':
				let strRelease = `${Title} was released on ${Released} and it has a rating of ${imdbRating} from IMDB`;
				sendTextMessage(sender, strRelease);
				moviequickreply(sender, category);
			break;
//
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
		var textArray = [
    `I wasn't originally going to get a brain transplant, but then I changed my mind. 😏`,
    `I would like tell you a chemistry joke at this point, but I know I wouldn't get a reaction. 😓`,
		`Have you ever tried to eat a clock? It's very time consuming. ⏱`,
		`I'm reading a book about anti-gravity. It's impossible to put down. 📕`,
		`Why don't programmers like nature? It has too many bugs. 🐜`,
		`You know, I don't trust these stairs because they're always up to something. 🤔`
			];
		var random = Math.floor(Math.random()*textArray.length);
		sendTextMessage(sender, textArray[random]);
    let str = `But series-ly though, I didn't quite understand that. You might wanna access the menu if you are lost, or head back to the main menu, alright?`;
          consufedquickreply(sender, str);
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

	var messageData = {
		recipient: {
			id: sender
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "open_graph",
					elements: [{
						url : link
					}]
				}
			}
		}
	};

	callSendAPI(messageData);


	let option = "Select other options";
	setTimeout(function(){
	moviequickreply(sender, category);
        },2500);

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
							"title": "Know the Release Year and Rating",
							"image_url": "http://i.imgur.com/Gbd4YFV.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Year and Rating",
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
							"title": "Add to Favorites",
							"image_url": "http://i.imgur.com/HNjfVQk.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Add",
									"payload": "favorites/" + tvshow
								}
							]
						},
            			{
							"title": "Back to Main Menu",
							"image_url": "http://i.imgur.com/FEmuU4p.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Back to Main Menu",
									"payload": "searchAgain"
								}
							]
						}
					];
					sendGenericMessage(sender, elements);
					console.log(tvshow +  "THIS IS TVSHOW INSIDE SENDMOVIECARDS");
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

function sendMovieCardsGenre(sender){

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
							"title": "Know the Release Year and Rating",
							"image_url": "http://i.imgur.com/Gbd4YFV.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Year and Rating",
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
							"title": "Add to Favorites",
							"image_url": "http://i.imgur.com/HNjfVQk.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Add",
									"payload": "favorites/" + tvshow
								}
							]
						},
            			{
							"title": "Back to Main Menu",
							"image_url": "http://i.imgur.com/FEmuU4p.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Back to Main Menu",
									"payload": "searchAgain"
								}
							]
						},
						{
								"title": "Select Other Genres",
								"image_url": 'http://i.imgur.com/TZ2LGfo.png',
								"buttons": [
									{
										"type": "postback",
										"title": "Other genres",
										"payload": "recommendGenre"
									}
								]
							},
							{
								"title": "Back to Recommendation Menu",
								"image_url": 'http://i.imgur.com/tPICPoU.png',
								"buttons": [
									{
										"type": "postback",
										"title": "Recommendation menu",
										"payload": "recommend"
									}
								]
							}
					];
					sendGenericMessage(sender, elements);
					console.log(tvshow +  "THIS IS TVSHOW INSIDE SENDMOVIECARDSGENRE");
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
function sendMovieCardsTv (sender){

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
							"title": "Know the Release Year and Rating",
							"image_url": "http://i.imgur.com/Gbd4YFV.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Year and Rating",
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
							"title": "Add to Favorites",
							"image_url": "http://i.imgur.com/HNjfVQk.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Add",
									"payload": "favorites/" + tvshow
								}
							]
						},
            			{
							"title": "Back to Main Menu",
							"image_url": "http://i.imgur.com/FEmuU4p.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Back to Main Menu",
									"payload": "searchAgain"
								}
							]
						},
						{
								"title": "Select Other Genres",
								"image_url": 'http://i.imgur.com/TZ2LGfo.png',
								"buttons": [
									{
										"type": "postback",
										"title": "Other genres",
										"payload": "recommendTV"
									}
								]
							},
							{
								"title": "Back to Recommendation Menu",
								"image_url": 'http://i.imgur.com/tPICPoU.png',
								"buttons": [
									{
										"type": "postback",
										"title": "Recommendation menu",
										"payload": "recommend"
									}
								]
							}
					];
					sendGenericMessage(sender, elements);
					console.log(tvshow +  "THIS IS TVSHOW INSIDE SENDMOVIECARDSTV");
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


function sendMovieCardsYear(sender){

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
							"title": "Know the Release Year and Rating",
							"image_url": "http://i.imgur.com/Gbd4YFV.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Year and Rating",
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
							"title": "Add to Favorites",
							"image_url": "http://i.imgur.com/HNjfVQk.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Add",
									"payload": "favorites/" + tvshow
								}
							]
						},
            			{
							"title": "Back to Main Menu",
							"image_url": "http://i.imgur.com/FEmuU4p.png",
							"buttons": [
								{
									"type": "postback",
									"title": "Back to Main Menu",
									"payload": "searchAgain"
								}
							]
						},
							{
								"title": "Back to recommendation menu",
								"image_url": 'http://i.imgur.com/tPICPoU.png',
								"buttons": [
									{
										"type": "postback",
										"title": "Recommendation menu",
										"payload": "recommend"
									}
								]
							}
					];
					sendGenericMessage(sender, elements);
					console.log(tvshow +  "THIS IS TVSHOW INSIDE SENDMOVIECARDSYEAR");
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


function knowfullcast(sender, Title){
		request({
        uri: "https://www.googleapis.com/customsearch/v1?",
        qs: {
          q: Title + " full cast",
          cx: `011868887043149504159:-5-5cnusvca`,
          siteSearch: `https://www.imdb.com/`,
          fields: 'items',
          key: `AIzaSyCOdpES79O2cqWNdxNaLs_6g68cNdWBsWw`,
        },
        method: 'GET'
      }, (error, response, body) => {
        var items = JSON.parse(body);
        if(!error && response.statusCode === 200){
          (createResponseCast(sender, items));
        } else{
          //reject(error);
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
        var items = JSON.parse(body);
        if(!error && response.statusCode === 200){
          (createResponseDirector(sender, items));
        } else{
          //reject(error);
        }
      });
}

	function createResponseCast(sender, title){
		if(title){
			let{
        items:[{
			link
				}]
		} = title;

		//sendTextMessage(sender, `If you want to know the full cast of ${tvshow}, click the link below: \n ${link}`);
		setTimeout(function(){
				moviequickreply(sender, category, link);
				},2000);
	}
}

function createResponseDirector(sender, director){
	if(director){
    console.log("Umabot ng director" + JSON.stringify(director));
    let{
        items:[{
			link,
			pagemap: {
				person: [{
					role
				},
					{
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

function moviequickreplyfave(sender){
	let elements = [						
		{
							"title": "Select an option",
							"image_url": "",
							"buttons": [
								{
                "type":"postback",
                "title":"Back to Main Menu",
                "payload":"searchAgain"
              }
							]
		}            
					];
					sendGenericMessage(sender, elements);

}

function moviequickreply(sender, category, link){
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
					if(category == 'genre'){
						if(link != undefined || link != null){
							let elements = [
						{
							"title": "Select an option",
							"image_url": "http://i.imgur.com/cXWoKWP.png",
							"buttons": [
						{
                "type":"web_url",
                "title":"View Full List",
								"url": link
              },
              {
                "type":"postback",
                "title":"Show choices",
								"payload":"Show_Choices_Genre"
              },{
                "type":"postback",
                "title":"Back to Main Menu",
                "payload":"searchAgain"
              }
            ]
						}
					];
					sendGenericMessage(sender, elements);

						}else{
					let elements = [
						{
							"title": "Select an option",
							"image_url": "",
							"buttons": [
              {
                "type":"postback",
                "title":"Show choices",
								"payload":"Show_Choices_Genre"
              },{
                "type":"postback",
                "title":"Back to Main Menu",
                "payload":"searchAgain"
              }
            ]
						}
					];
					sendGenericMessage(sender, elements);
			}//else
					}else if(category == 'year'){
						if(link != undefined || link != null){
							let elements = [
						{
							"title": "Select an option",
							"image_url": "http://i.imgur.com/cXWoKWP.png",
							"buttons": [
						{
                "type":"web_url",
                "title":"View Full List",
								"url": link
              },
							{
                "type":"postback",
                "title":"Show choices",
								"payload":"Show_Choices_Year"
              },{
                "type":"postback",
                "title":"Back to Main Menu",
                "payload":"searchAgain"
              }
            ]
					}
				];
				sendGenericMessage(sender, elements);
		}else{
					let elements = [
						{
							"title": "Select an option",
							"image_url": "",
							"buttons": [
              {
                "type":"postback",
                "title":"Show choices",
								"payload":"Show_Choices_Year"
              },{
                "type":"postback",
                "title":"Back to Main Menu",
                "payload":"searchAgain"
              }
            ]
						}
					];
					sendGenericMessage(sender, elements);
			}//else
				}else if(category == 'tv' ){
					if(link != undefined || link != null){
							let elements = [
						{
							"title": "Select an option",
							"image_url": "http://i.imgur.com/cXWoKWP.png",
							"buttons": [
						{
                "type":"web_url",
                "title":"View Full List",
								"url": link
              },{
                "type":"postback",
                "title":"Show choices",
								"payload":"Show_Choices_Tv"
              },{
                "type":"postback",
                "title":"Back to Main Menu",
                "payload":"searchAgain"
              }
            ]
					}
		  ];
			sendGenericMessage(sender, elements);
					}else{
					
				let elements = [
						{
							"title": "Select an option",
							"image_url": "",
							"buttons": [
              {
                "type":"postback",
                "title":"Show choices",
								"payload":"Show_Choices_Tv"
              },{
                "type":"postback",
                "title":"Back to Main Menu",
                "payload":"searchAgain"
              }
            ]
						}
					];
					sendGenericMessage(sender, elements);
				}//else
		}else if (link!= null || link != undefined){
			
				let elements = [
						{
							"title": "Select an option",
							"image_url": "http://i.imgur.com/cXWoKWP.png",
							"buttons": [
						{
                "type":"web_url",
                "title":"View Full List",
								"url": link
              },{
                "type":"postback",
                "title":"Show choices",
								"payload":"Show_Choices"
              },{
                "type":"postback",
                "title":"Back to Main Menu",
                "payload":"searchAgain"
              }
            ]
					}
		  ];
			sendGenericMessage(sender, elements);
		}
				else{
					let elements = [
						{
							"title": "Select an option",
							"image_url": "",
							"buttons": [
              {
                "type":"postback",
                "title":"Show choices",
								"payload":"Show_Choices"
              },{
                "type":"postback",
                "title":"Back to Main Menu",
                "payload":"searchAgain"
              }
            ]
						}
					];
					sendGenericMessage(sender, elements);
				}
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

function consufedquickreply(sender, text){
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
			"title": "Back to Main Menu",
			"payload":"Back to Main Menu"
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

function actorerrorquickreply(sender, text){
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
			"title": "Back to Main Menu",
			"payload":"Back to Main Menu"
		},
		{
			"content_type": "text",
			"title": "Re-type name",
			"payload":"Re-type name"
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
	responseText = response.result.fulfillment.speech;
	let responseData = response.result.fulfillment.data;
	let messages = response.result.fulfillment.messages;
	let action = response.result.action;
	let contexts = response.result.contexts;
	let parameters = response.result.parameters;

	sendTypingOff(sender);

	if (isDefined(messages) && (messages.length == 1 && messages[0].type != 0 || messages.length > 1) && action != "input.unknown") {
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
	console.log("Generic message was called");
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
    let recTitle = payload.split("/")[1];
		category = payload.split("/")[2];
    tvshow = recTitle.toLowerCase();
    let intents = "posters";
    payload = "card";
    omdb(senderID, intents, tvshow, category);//add new variable to distinguish genre etc.
  }

  if(payload.includes("favorites")){
    let favTitle = payload.split("/")[1];
    tvshow = favTitle.toLowerCase();
    payload = "addfavorites";
    addToFavorites(senderID, tvshow, imagePath, category);
  }

  if(payload.includes("remove")){
    let remTitle = payload.split("/")[1];
    tvshow = remTitle.toLowerCase();
    payload = "remFavorites";
    removeFavorites(senderID, tvshow);
  }

	switch (payload) {
		case "FACEBOOK_WELCOME":
			sendToApiAi(senderID, "Get Started");
		break;

		case "backMenu":
		sendToApiAi(senderID, "Back to Main Menu");
		break;

    case "addfavorites":
      console.log("napunta sa favorites");
    break;

    case 'remFavorites':
      console.log("napunta sa remove favorites");
    break;

    case "searchAgain":
      sendToApiAi(senderID, "Back to Main Menu");
    break;

    case "Show_Choices":
      sendToApiAi(senderID, "Show Choices");
    break;

		case "Show_Choices_Genre":
      sendToApiAi(senderID, "Show_Choices_Genre");
    break;

		case "Show_Choices_Year":
			sendToApiAi(senderID, "Show_Choices_Year");
		break;

		case "Show_Choices_Tv":
			sendToApiAi(senderID, "Show_Choices_Tv");
		break;

    case "recommendGenre":
      sendToApiAi(senderID, "Recommend Genre");
    break;

		case "moregenre":
			tmdbMovieDiscover(senderID, genre);
		break;

		case "moregenretv":
			tmdbTVDiscover(senderID,genre);
		break;


		case "moreyear":
			yearSearch(senderID, year);
		break;

    case "Recommend Year":
    console.log("Napunta sa Recommend Year");
      sendToApiAi(senderID, "Recommend Year");
    break;

		case "getStarted":
			sendToApiAi(senderID, "Get Started");
		break;

    case "getList":
      getFavorites(senderID);
    break;

    case "showSearch":
      sendToApiAi(senderID, "Know About A Series");
    break;

    case "recommend":
      sendToApiAi(senderID, "Recommend Me");
    break;

    case "actorSearch":
      sendToApiAi(senderID, "actorSearch");
    break;
		case "aboutplot":
			var intents = "plot";
			omdb(senderID, intents, tvshow, category);
		break;

		case "aboutdirector":
			var intents = 'director';
			omdb(senderID, intents, tvshow, category);
		break;

		case "aboutcast":
			var intents = 'cast';
			omdb(senderID, intents, tvshow, category);
		break;

		case "aboutreleaseyear":
			var intents = "releaseyear";
			omdb(senderID, intents, tvshow, category);
		break;

		case "abouttrailer" :
			var intents = "trailerInfo";
			omdb(senderID, intents, tvshow, category);
		break;

	  case "recommendMovie":
      sendToApiAi(senderID, "recommendMovie");
    break;

    case "recommendTV":
      sendToApiAi(senderID, "recommendTV");
    break;

		case "movieAction":
			genre = "action";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieAdventure":
			genre = "adventure";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieAnimation":
			genre = "animation";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieComedy":
			genre = "comedy";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieDrama":
			genre = "drama";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieFantasy":
			genre = "fantasy";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieHorror":
			genre = "horror";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieMusic":
			genre = "music";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieRomance":
			genre = "romance";
			tmdbMovieDiscover(senderID, genre);
		break;

		case "movieSciFi":
			genre = "science fiction";
			tmdbMovieDiscover(senderID, genre);
		break;

    case "tvAction":
      genre = "action";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvAnimation":
      genre = "animation";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvComedy":
      genre = "comedy";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvDocumentary":
      genre = "documentary";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvDrama":
      genre = "drama";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvFamily":
      genre = "family";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvKids":
      genre = "kids";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvMystery":
      genre = "mystery";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvReality":
      genre = "reality";
      tmdbTVDiscover(senderID, genre);
    break;

    case "tvSciFi":
      genre = "science fiction";
      tmdbTVDiscover(senderID, genre);
    break;

    case "card":
      console.log("pumasok ng card case");
    break;

    case "upcomingMovies":
      tmdbUpcoming(senderID);
    break;

		default:
			//unindentified payload
			sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
			break;

	}

	console.log("Received postback for user %d and page %d with payload '%s' " +
		"at %d", senderID, recipientID, payload, timeOfPostback);

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
