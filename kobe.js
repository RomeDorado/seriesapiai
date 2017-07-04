// //str = "how i met your mother";


//    str =  str.replace(/\w\S*/g, function(txt){
//      return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});


// //console.log(str);

// var title = "kobe"
//  var text = "card/"+title + "/bryant";

//  let firstname = text.split("/")[1];
//  let secondname = text.split("/")[2];

//  console.log("firstname: "+ firstname + " second name: " +secondname);

//  var trim = require('trim')
// var wtj = require('website-to-json')
 
// wtj.extractUrl('http://www.imdb.com/news/tv', {
//   fields: ['data'],
//   parse: function($) {
//     return {
//       title: trim($(".title_wrapper h1").text()),
//       image: $(".poster img").attr('src'),
//       summary: trim($(".plot_summary .summary_text").text())
//     }
//   }
// })
// .then(function(res) {
//   console.log(JSON.stringify(res, null, 2));
// });
	var textArray = [
    `I wasn't originally going to get a brain transplant, but then I changed my mind. 😏`,
    `I would like tell you a chemistry joke at this point, but I know I wouldn't get a reaction. 😓`,
		`Have you ever tried to eat a clock? It's very time consuming. ⏱`,
		`I'm reading a book about anti-gravity. It's impossible to put down. 📕`,
		`Why don't programmers like nature? It has too many bugs. 🐜`,
		`You know, I don't trust these stairs because they're always up to something. 🤔`
			];
		var random = Math.floor(Math.random()*textArray.length);
		console.log(textArray[random]);