// Proxy MUST update previously cached headers on 304 responses.
//
// babel-node --optional es7.asyncFunctions tests/test-...

import Promise from "bluebird";
import ProxyCase from "./ProxyCase";
import * as Uri from "../src/anyp/Uri";
import Body from "../src/http/Body";
import Resource from "../src/anyp/Resource";
import * as FuzzyTime from "../src/misc/FuzzyTime";
import assert from "assert";

process.on("unhandledRejection", function (reason /*, promise */) {
    console.log("Quitting on a rejected promise:", reason);
    throw reason;
});
Promise.config({ warnings: true });

// TODO: Optionally tolerate any misses (mostly useful for parallel/life tests).

async function Test() {

    let resource = new Resource();
    resource.uri = Uri.Unique();
    resource.modifiedAt(FuzzyTime.DistantPast());
    resource.expireAt(FuzzyTime.Soon());
    resource.body = new Body("x".repeat(64*1024));

    {
        let testCase = new ProxyCase('forward a cachable response');
        testCase.client().request.for(resource);
        testCase.server().serve(resource);
        testCase.server().response.tag("first");
        await testCase.run();
    }

    {
        let testCase = new ProxyCase('respond with a 304 hit');
        testCase.client().request.for(resource);
        testCase.client().request.conditions({ ims: resource.notModifiedSince() });
        testCase.check(() => {
            testCase.expectStatusCode(304);
        });
        await testCase.run();
    }

    let updatingResponse = null; // TBD
    {
        let testCase = new ProxyCase('miss and get a 304 that updates the previously cached response');

        resource.modifyNow();
        resource.expireAt(FuzzyTime.DistantFuture());

        testCase.client().request.for(resource);
        testCase.client().request.conditions({ ims: resource.modifiedSince() });
        testCase.client().request.header.add("Cache-Control", "max-age=0");

        testCase.server().serve(resource);
        testCase.server().response.tag("second");
        testCase.server().response.startLine.statusCode = 304;

        testCase.check(() => {
            testCase.expectStatusCode(200);
            // XXX: Check the headers.
            updatingResponse = testCase.server().transaction().response;
        });

        await testCase.run();
    }

    {
        let testCase = new ProxyCase('hit updated headers');
        testCase.client().request.for(resource);
        testCase.check(() => {
            testCase.expectStatusCode(200);
            let updatedResponse = testCase.client().transaction().response;
            assert.equal(updatedResponse.tag(), updatingResponse.tag(), "updated X-Daft-Response-Tag");
            assert.equal(updatedResponse.id(), updatingResponse.id(), "updated X-Daft-Response-ID");
            assert.equal(updatedResponse.header.values("Last-Modified"), resource.lastModificationTime.toUTCString(), "updated Last-Modified");
            assert.equal(updatedResponse.header.values("Expires"), resource.nextModificationTime.toUTCString(), "updated Expires");
        });
        await testCase.run();
    }

    console.log("Test result: success");
}

Test();
