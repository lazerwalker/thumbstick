var fs = require('fs');

fs.unlink('./thumbstick.temp.js', function (err) {
    if (err) {
        console.error(err);
        return;
    }
    console.log('- removed ./thumbstick.temp.js');
});
