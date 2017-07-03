//str = "how i met your mother";


   str =  str.replace(/\w\S*/g, function(txt){
     return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});


//console.log(str);

var title = "kobe"
 var text = "card/"+title + "/bryant";

 let firstname = text.split("/")[1];
 let secondname = text.split("/")[2];

 console.log("firstname: "+ firstname + " second name: " +secondname);
