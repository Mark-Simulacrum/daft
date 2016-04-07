/* Daft Toolkit                         http://www.measurement-factory.com/
 * Copyright (C) 2015,2016 The Measurement Factory.
 * Licensed under the Apache License, Version 2.0.                       */

/* Incrementally parses an HTTP message, including first-line, headers, and body */

import Field from "../Field";
import Header from "../Header";
import Body from "../Body";
import { Must } from "../../misc/Gadgets";

export default class MessageParser {

    constructor(transaction) {
        this.transaction = transaction;
        this.message = null;
        this._messageType = null; // kids must set this in their constructors

        this._raw = ""; // unparsed data
        this.expectBody = true;
    }

    parse(data) {
        this._raw += data;

        if (!this.message)
            this.parsePrefix();

        if (this.message && this.message.body)
            this.parseBody();

        // TODO: complain about leftovers
    }

    parsePrefix() {
        let messageRe = /^(.*\r*\n)([\s\S]*?\n)(\r*\n)([\s\S]*)$/;
        let match = messageRe.exec(this._raw.toString());
        if (match === null) {
            console.log("no end of headers yet");
            return;
        }

        this.message = new this._messageType();
        this.message.startLine = this.parseStartLine(match[1]);
        this.message.header = this.parseHeader(match[2]);
        this.message.headerDelimiter = match[3];
        this._raw = match[4]; // body [prefix] or an empty string

        this.determineBodyLength();
    }

    parseStartLine(/*raw*/) {
        Must(false, "pure virtual: kids must override");
    }

    parseField(raw) {
        let fieldRe = /^(.*?)([\t ]*:[\t ]*)(.*?)([\t \r]*\n)$/;
        const match = fieldRe.exec(raw);

        let field = new Field();

        if (match) {
            Must(match.length === 5);
            field.name = match[1]; // right-trimmed
            field.separator = match[2];
            field.value = match[3]; // trimmed
            field.terminator = match[4];
        } else {
            console.log(`Warning: Cannot parse ${raw.length}-byte header field: ${raw}`);
            field.name = raw;
            field.separator = "";
            field.value = "";
            field.terminator = "";
        }

        return field;
    }

    parseHeader(raw) {
        let header = new Header();

        Must(raw !== null && raw !== undefined);
        header._raw = raw;

        // replace obs-fold with a single space
        let rawH = raw.replace(/\r*\n\s+/, ' ');

        let rawFields = rawH.split('\n');
        Must(rawFields.length); // our caller requires CRLF at the headers end
        Must(!rawFields.pop().length); // the non-field after the last CRLF
        for (let rawField of rawFields) {
            header.fields.push(this.parseField(rawField + "\n"));
        }

        if (!header.fields.length)
            console.log(`Warning: Found no headers in ${rawH}`);

        return header;
    }

    // called for messages with neither Content-Length nor chunked encoding
    // must create and configure a body if one is needed
    determineDefaultBody() {
        Must(false); // pure virtual: kids must override
    }

    determineBodyLength() {
        Must(!this.message.body);
        if (!this.expectBody)
            return;
        // TODO: set true body length when possible
        // XXX: do not disclaim body presence when there is one
        let len = this.message.header.contentLength();
        if (len === null)
            this.determineDefaultBody();
        else if (len === undefined) {
            this.message.body = new Body();
            console.log("Warning: Cannot determine message length");
        } else {
            this.message.body = new Body();
            this.message.body.setLength(len);
            console.log("expecting %d message body bytes", len);
        }
    }

    parseBody() {
        Must(this.message.body);
        // TODO: dechunk (and set final length) as needed
        this.message.body.in(this._raw);
        this._raw = "";
    }
}
