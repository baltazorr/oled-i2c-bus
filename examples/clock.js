/*
 * clock.js
 * Display a digital clock on a small I2C connected display
 * 
 * 2016-11-28 v1.0 Harald Kubota
 */


"use strict";

var i2c = require('i2c-bus'),
    i2cBus = i2c.openSync(0),
    oled = require('oled-i2c-bus').Oled;

const SIZE_X = 128,
    SIZE_Y = 64;

var opts = {
    width: SIZE_X,
    height: SIZE_Y,
    address: 0x3C
};

var oled = new oled(i2cBus, opts);


oled.clearDisplay();
oled.turnOnDisplay();

oled.drawPixel([
    [SIZE_X - 1, 0, 1],
    [SIZE_X - 1, SIZE_Y - 1, 1],
    [0, SIZE_Y - 1, 1],
    [0, 0, 1]
]);

oled.drawLine(1, 1, SIZE_X - 2, 1, 1);
oled.drawLine(SIZE_X - 2, 1, SIZE_X - 2, SIZE_Y - 2, 1);
oled.drawLine(SIZE_X - 2, SIZE_Y - 2, 1, SIZE_Y - 2, 1);
oled.drawLine(1, SIZE_Y - 2, 1, 1, 1);

var font = require('oled-font-5x7');

// Clock

function displayClock() {
    var date = new Date();
    var hour = date.getHours();
    hour = (hour < 10 ? "0" : "") + hour;
    var min = date.getMinutes();
    min = (min < 10 ? "0" : "") + min;
    var sec = date.getSeconds();
    sec = (sec < 10 ? "0" : "") + sec;

    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;
    var day = date.getDate();
    day = (day < 10 ? "0" : "") + day;

    // Location fits 128x64 OLED
    oled.setCursor(12, 25);
    oled.writeString(font, 2, hour + ":" + min + ":" + sec, 1, true);
}

setInterval(displayClock, 1000);