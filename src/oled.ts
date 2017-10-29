import {Commands} from './commands'
import {Config} from './config'
import {} from 'node'

export class Oled {

    private height:number;
    private width:number;
    private adrress:number;
    private protocol:string;
    private lineSpacing:number;
    private letterSpacing:number;
    private cursorX:number;
    private cursorY:number;
    private buffer:Buffer;
    private dirtyBytes:Array<number>;
    private wire:any;
    private screenConfig:any;

    constructor(i2c:any, opts:Config) {
        this.height = opts.height || 32;
        this.width = opts.width || 128;
        this.adrress = opts.address || 0x3C;
        this.protocol = 'I2C';
        this.lineSpacing = typeof opts.linespacing !== 'undefined' ? opts.linespacing : 1;
        this.letterSpacing = typeof opts.letterspacing !== 'undefined' ? opts.letterspacing : 1; 
        this.cursorX = 0;
        this.cursorY = 0;
    
        if(typeof Buffer.alloc == "undefined") {
            this.buffer = new Buffer((this.width * this.height) / 8);
        }

        else {
            this.buffer = Buffer.alloc((this.width * this.height) / 8);
        }
        this.buffer.fill(0x00);

        this.dirtyBytes = [];

        let config:any = {
            '128x32': { 'multiplex': 0x1F, 'compins': 0x02, 'coloffset': 0 },
            '128x64': { 'multiplex': 0x3F, 'compins': 0x12, 'coloffset': 0 },
            '96x16': { 'multiplex': 0x0F, 'compins': 0x2, 'coloffset': 0, }
        };

        this.wire = i2c;

        var screenSize = this.width + 'x' + this.height;
        this.screenConfig = config[screenSize];

        this._initialise();
    }

    private _initialise() {
          // sequence of bytes to initialise with
        var initSeq = [
            Commands.DISPLAY_OFF,
            Commands.SET_DISPLAY_CLOCK_DIV, 0x80,
            Commands.SET_MULTIPLEX, this.screenConfig.multiplex, // set the last value dynamically based on screen size requirement
            Commands.SET_DISPLAY_OFFSET, 0x00, // sets offset pro to 0
            Commands.SET_START_LINE,
            Commands.CHARGE_PUMP, 0x14, // charge pump val
            Commands.MEMORY_MODE, 0x00, // 0x0 act like ks0108
            Commands.SEG_REMAP, // screen orientation
            Commands.COM_SCAN_DEC, // screen orientation change to INC to flip
            Commands.SET_COM_PINS, this.screenConfig.compins, // com pins val sets dynamically to match each screen size requirement
            Commands.SET_CONTRAST, 0x8F, // contrast val
            Commands.SET_PRECHARGE, 0xF1, // precharge val
            Commands.SET_VCOM_DETECT, 0x40, // vcom detect
            Commands.DISPLAY_ALL_ON_RESUME,
            Commands.NORMAL_DISPLAY,
            Commands.DISPLAY_ON
        ];
        
        var i, initSeqLen = initSeq.length;
        
        // write init seq commands
        for (i = 0; i < initSeqLen; i ++) {
            this._transfer('cmd', initSeq[i]);
        }
    }

    // writes both commands and data buffers to this device
    private _transfer(type:string, val:number, fn?:()=>void) {
        var control;
        if (type === 'data') {
            control = 0x40;
        } else if (type === 'cmd') {
            control = 0x00;
        } else {
            return;
        }

        var bufferForSend, sentCount;
        //For version <6.0.0
        if (typeof Buffer.from == "undefined") {
            bufferForSend = new Buffer([control, val]);
        }
        //For version >=6.0.0
        else {
            bufferForSend = Buffer.from([control, val])
        }

        // send control and actual val
        sentCount = this.wire.i2cWriteSync(this.adrress, 2, bufferForSend);
        if (fn) {
            fn();
        }
    }

    // read a byte from the oled
    private _readI2C(fn:(o:number)=>void) {
        //For version <6.0.0
        if (typeof Buffer.from == "undefined") {
            this.wire.i2cRead(this.adrress, 0, new Buffer([0]), function(err:Error, bytesRead:number, data:Buffer) {
                // result is single byte
                if (typeof data === "object") {
                    fn(data[0]);
                } else {
                    fn(0);
                }
            });
        }
        //For version >=6.0.0
        else {
            var data = [0];
            this.wire.i2cReadSync(this.adrress, 1, Buffer.from(data));
            fn(data[0]);
        }
    }

    // sometimes the oled gets a bit busy with lots of bytes.
    // Read the response byte to see if this is the case
    private _waitUntilReady(callback:()=>void) {
        var done,
            oled = this;

        function tick(callback:()=>void) {
            oled._readI2C(function(byte) {
                // read the busy byte in the response
                let busy = byte >> 7 & 1;
                if (!busy) {
                    // if not busy, it's ready for callback
                    callback();
                } else {
                    setTimeout(function() { tick(callback) }, 0);
                }
            });
        };

        setTimeout(function() { tick(callback) }, 0);
    }

    // set starting position of a text string on the oled
    public setCursor(x:number, y:number) {
        this.cursorX = x;
        this.cursorY = y;
    }

    // write text to the oled
    public writeString(font:any, size:number, string:string, color:any, wrap:boolean, sync?:boolean) {
        var immed = (typeof sync === 'undefined') ? true : sync;
        var wordArr = string.split(' '),
            len = wordArr.length,
            // start x offset at cursor pos
            offset = this.cursorX,
            padding = 0;

        // loop through words
        for (var w = 0; w < len; w += 1) {
            // put the word space back in for all in between words or empty words
            if (w < len - 1 || !wordArr[w].length) {
                wordArr[w] += ' ';
            }
            var stringArr = wordArr[w].split(''),
                slen = stringArr.length,
                compare = (font.width * size * slen) + (size * (len - 1));

            // wrap words if necessary
            if (wrap && len > 1 && (offset >= (this.width - compare))) {
                offset = 0;

                this.cursorY += (font.height * size) + this.lineSpacing;
                this.setCursor(offset, this.cursorY);
            }

            // loop through the array of each char to draw
            for (var i = 0; i < slen; i += 1) {
                if (stringArr[i] === '\n') {
                    offset = 0;
                    this.cursorY += (font.height * size) + this.lineSpacing;
                    this.setCursor(offset, this.cursorY);
                } else {
                    // look up the position of the char, pull out the buffer slice
                    var charBuf = this._findCharBuf(font, stringArr[i]);
                    // read the bits in the bytes that make up the char
                    var charBytes = this._readCharBytes(charBuf);
                    // draw the entire character
                    this._drawChar(charBytes, size, false);

                    // calc new x position for the next char, add a touch of padding too if it's a non space char
                    //padding = (stringArr[i] === ' ') ? 0 : this.LETTERSPACING;
                    offset += (font.width * size) + this.letterSpacing; // padding;

                    // wrap letters if necessary
                    if (wrap && (offset >= (this.width - font.width - this.letterSpacing))) {
                        offset = 0;
                        this.cursorY += (font.height * size) + this.lineSpacing;
                    }
                    // set the 'cursor' for the next char to be drawn, then loop again for next char
                    this.setCursor(offset, this.cursorY);
                }
            }
        }
        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }

    // draw an individual character to the screen
    private _drawChar(byteArray:any, size:number, sync:boolean) {
        // take your positions...
        var x = this.cursorX,
            y = this.cursorY;

        // loop through the byte array containing the hexes for the char
        for (var i = 0; i < byteArray.length; i += 1) {
            for (var j = 0; j < 8; j += 1) {
                // pull color out
                var color = byteArray[i][j],
                    xpos, ypos;
                // standard font size
                if (size === 1) {
                    xpos = x + i;
                    ypos = y + j;
                    this.drawPixel([xpos, ypos, color], false);
                } else {
                    // MATH! Calculating pixel size multiplier to primitively scale the font
                    xpos = x + (i * size);
                    ypos = y + (j * size);
                    this.fillRect(xpos, ypos, size, size, color, false);
                }
            }
        }
    }

    // get character bytes from the supplied font object in order to send to framebuffer
    private _readCharBytes(byteArray:Array<number>) {
        var bitArr = [],
            bitCharArr = [];
        // loop through each byte supplied for a char
        for (var i = 0; i < byteArray.length; i += 1) {
            // set current byte
            var byte = byteArray[i];
            // read each byte
            for (var j = 0; j < 8; j += 1) {
                // shift bits right until all are read
                var bit = byte >> j & 1;
                bitArr.push(bit);
            }
            // push to array containing flattened bit sequence
            bitCharArr.push(bitArr);
            // clear bits for next byte
            bitArr = [];
        }
        return bitCharArr;
    }

    // find where the character exists within the font object
    private _findCharBuf(font:any, c:any) {
        // use the lookup array as a ref to find where the current char bytes start
        var cBufPos = font.lookup.indexOf(c) * font.width;
        // slice just the current char's bytes out of the fontData array and return
        var cBuf = font.fontData.slice(cBufPos, cBufPos + font.width);
        return cBuf;
    }

    // send the entire framebuffer to the oled
    public update() {
        // wait for oled to be ready
        this._waitUntilReady(function() {
            // set the start and endbyte locations for oled display update
            var displaySeq = [
                this.COLUMN_ADDR,
                this.screenConfig.coloffset,
                this.screenConfig.coloffset + this.WIDTH - 1, // column start and end address
                this.PAGE_ADDR, 0, (this.HEIGHT / 8) - 1 // page start and end address
            ];

            var displaySeqLen = displaySeq.length,
                bufferLen = this.buffer.length,
                i, v;

            // send intro seq
            for (i = 0; i < displaySeqLen; i += 1) {
                this._transfer('cmd', displaySeq[i]);
            }

            // write buffer data
            for (v = 0; v < bufferLen; v += 1) {
                this._transfer('data', this.buffer[v]);
            }

        }.bind(this));
    }

    // send dim display command to oled
    public dimDisplay(bool:boolean) {
        var contrast;

        if (bool) {
            contrast = 0; // Dimmed display
        } else {
            contrast = 0xCF; // Bright display
        }

        this._transfer('cmd', Commands.SET_CONTRAST);
        this._transfer('cmd', contrast);
    }

    // turn oled off
    public turnOffDisplay() {
        this._transfer('cmd', Commands.DISPLAY_OFF);
    }

    // turn oled on
    public turnOnDisplay() {
        this._transfer('cmd', Commands.DISPLAY_ON);
    }

    // clear all pixels currently on the display
    public clearDisplay(sync?:boolean) {
        var immed = (typeof sync === 'undefined') ? true : sync;
        // write off pixels
        //this.buffer.fill(0x00);
        for (var i = 0; i < this.buffer.length; i += 1) {
            if (this.buffer[i] !== 0x00) {
                this.buffer[i] = 0x00;
                if (this.dirtyBytes.indexOf(i) === -1) {
                    this.dirtyBytes.push(i);
                }
            }
        }
        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }

    // invert pixels on oled
    public invertDisplay(bool:boolean) {
        if (bool) {
            this._transfer('cmd', Commands.INVERT_DISPLAY); // inverted
        } else {
            this._transfer('cmd', Commands.NORMAL_DISPLAY); // non inverted
        }
    }

    // draw an image pixel array on the screen
    public drawBitmap(pixels:Array<Array<number>>, sync?:boolean) {
        var immed = (typeof sync === 'undefined') ? true : sync;
        var x, y,
            pixelArray = [];

        for (var i = 0; i < pixels.length; i++) {
            x = Math.floor(i % this.width);
            y = Math.floor(i / this.width);

            this.drawPixel([x, y, pixels[i]], false);
        }

        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }

    // draw one or many pixels on oled
    public drawPixel(pixels:any, sync?:boolean) {
        var immed = (typeof sync === 'undefined') ? true : sync;

        // handle lazy single pixel case
        if (typeof pixels[0] !== 'object') pixels = [pixels];

        pixels.forEach(function(el:Array<number>) {
            // return if the pixel is out of range
            var x = el[0],
                y = el[1],
                color = el[2];
            if (x >= this.WIDTH || y >= this.HEIGHT) return;

            // thanks, Martin Richards.
            // I wanna can this, this tool is for devs who get 0 indexes
            //x -= 1; y -=1;
            var byte = 0,
                page = Math.floor(y / 8),
                pageShift = 0x01 << (y - 8 * page);

            // is the pixel on the first row of the page?
            (page == 0) ? byte = x: byte = x + (this.WIDTH * page);

            // colors! Well, monochrome.
            if (color === 0) {
                this.buffer[byte] &= ~pageShift;
            }
            if (color > 0) {
                this.buffer[byte] |= pageShift;
            }

            // push byte to dirty if not already there
            if (this.dirtyBytes.indexOf(byte) === -1) {
                this.dirtyBytes.push(byte);
            }

        }, this);

        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }

    // looks at dirty bytes, and sends the updated bytes to the display
    private _updateDirtyBytes(byteArray:Array<number>) {
        var blen = byteArray.length,
            i,
            displaySeq = [];

        // check to see if this will even save time
        if (blen > (this.buffer.length / 7)) {
            // just call regular update at this stage, saves on bytes sent
            this.update();
            // now that all bytes are synced, reset dirty state
            this.dirtyBytes = [];

        } else {

            this._waitUntilReady(function() {
                // iterate through dirty bytes
                for (var i = 0; i < blen; i += 1) {

                    var byte = byteArray[i];
                    var page = Math.floor(byte / this.WIDTH);
                    var col = Math.floor(byte % this.WIDTH);

                    var displaySeq = [
                        this.COLUMN_ADDR, col, col, // column start and end address
                        this.PAGE_ADDR, page, page // page start and end address
                    ];

                    var displaySeqLen = displaySeq.length,
                        v;

                    // send intro seq
                    for (v = 0; v < displaySeqLen; v += 1) {
                        this._transfer('cmd', displaySeq[v]);
                    }
                    // send byte, then move on to next byte
                    this._transfer('data', this.buffer[byte]);
                    this.buffer[byte];
                }
            }.bind(this));
        }
        // now that all bytes are synced, reset dirty state
        this.dirtyBytes = [];
    }

    // using Bresenham's line algorithm
    public drawLine(x0:number, y0:number, x1:number, y1:number, color:number, sync?:boolean) {
        var immed = (typeof sync === 'undefined') ? true : sync;

        var dx = Math.abs(x1 - x0),
            sx = x0 < x1 ? 1 : -1,
            dy = Math.abs(y1 - y0),
            sy = y0 < y1 ? 1 : -1,
            err = (dx > dy ? dx : -dy) / 2;

        while (true) {
            this.drawPixel([[x0, y0, color]], false);

            if (x0 === x1 && y0 === y1) break;

            var e2 = err;

            if (e2 > -dx) { err -= dy;
                x0 += sx; }
            if (e2 < dy) { err += dx;
                y0 += sy; }
        }

        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }

    // draw a filled rectangle on the oled
    public fillRect(x:number, y:number, w:number, h:number, color:number, sync?:boolean) {
        var immed = (typeof sync === 'undefined') ? true : sync;
        // one iteration for each column of the rectangle
        for (var i = x; i < x + w; i += 1) {
            // draws a vert line
            this.drawLine(i, y, i, y + h - 1, color, false);
        }
        if (immed) {
            this._updateDirtyBytes(this.dirtyBytes);
        }
    }

    // activate scrolling for rows start through stop
    public startScroll(dir:string, start:number, stop:number) {
        var scrollHeader,
            cmdSeq:Array<number> = [];

        switch (dir) {
            case 'right':
                cmdSeq.push(Commands.RIGHT_HORIZONTAL_SCROLL);
                break;
            case 'left':
                cmdSeq.push(Commands.LEFT_HORIZONTAL_SCROLL);
                break;
                // TODO: left diag and right diag not working yet
            case 'left diagonal':
                cmdSeq.push(
                    Commands.SET_VERTICAL_SCROLL_AREA, 0x00,
                    Commands.VERTICAL_AND_LEFT_HORIZONTAL_SCROLL,
                    this.height
                );
                break;
                // TODO: left diag and right diag not working yet
            case 'right diagonal':
                cmdSeq.push(
                    Commands.SET_VERTICAL_SCROLL_AREA, 0x00,
                    Commands.VERTICAL_AND_RIGHT_HORIZONTAL_SCROLL,
                    this.height
                );
                break;
        }

        this._waitUntilReady(function() {
            cmdSeq.push(
                0x00, start,
                0x00, stop,
                // TODO: these need to change when diagonal
                0x00, 0xFF,
                this.ACTIVATE_SCROLL
            );

            var i, cmdSeqLen = cmdSeq.length;

            for (i = 0; i < cmdSeqLen; i += 1) {
                this._transfer('cmd', cmdSeq[i]);
            }
        }.bind(this));
    }

    // stop scrolling display contents
    public stopScroll() {
        this._transfer('cmd', Commands.DEACTIVATE_SCROLL); // stahp
    }
}