//str = "how i met your mother";


   str =  str.replace(/\w\S*/g, function(txt){
     return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});


//console.log(str);

var title = "kobe"
 var text = "card/"+title + "/bryant";

 let firstname = text.split("/")[1];
 let secondname = text.split("/")[2];

 console.log("firstname: "+ firstname + " second name: " +secondname);

 var trim = require('trim')
var wtj = require('website-to-json')
 
wtj.extractUrl('http://www.imdb.com/news/tv', {
  fields: ['data'],
  parse: function($) {
    return {
      title: trim($(".title_wrapper h1").text()),
      image: $(".poster img").attr('src'),
      summary: trim($(".plot_summary .summary_text").text())
    }
  }
})
.then(function(res) {
  console.log(JSON.stringify(res, null, 2));
});
