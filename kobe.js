str = "how i met your mother";


    str =  str.replace(/\w\S*/g, function(txt){
      return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});


console.log(str);
