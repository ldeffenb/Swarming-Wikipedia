import { Bee, Tag, Utils } from '@ethersphere/bee-js'

import { MantarayNode } from 'mantaray-js'
import { loadAllNodes } from 'mantaray-js'
import type { Reference, StorageLoader, StorageSaver } from 'mantaray-js'
import { initManifestNode, NodeType } from 'mantaray-js'
import { Semaphore } from 'async-mutex'; // https://npm.io/package/async-mutex https://github.com/DirtyHairy/async-mutex

import PATH from 'path'
import { resolve, relative } from 'path';

import http from 'node:http';
import https from 'node:https';
const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 1000 });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 1000 });

const axios = require('axios')
axios.default
axios.defaults.httpAgent = httpAgent
axios.defaults.httpsAgent = httpsAgent
axios.defaults.timeout = 10000	// Default of 10 second timeout

//import { buildAxiosFetch } from '@lifeomic/axios-fetch'

//const fetch = buildAxiosFetch(axios)

//const fetchOptions = {
//	agent: function(_parsedURL) {
//		if (_parsedURL.protocol == 'http:') {
//			return httpAgent;
//		} else {
//			return httpsAgent;
//		}
//	}
//};

//process.argv.forEach((val, index) => {
//  console.log(`${index}: ${val}`)
//})

const beeUrl = process.argv[3]
const batchID = process.argv[4]

var bee : Bee
try {
	bee = new Bee(beeUrl)
} catch (err) {
	showBoth(`${err}`)
}

let tagID = 0
const uploadDelay = 0	// msec to sleep after each upload to give node a chance to breathe (0 to disable)

var exitRequested = false
var Holding = false

async function waitForHold(what:string) {
	if (Holding) {
		showBoth(`Holding for ${what}`)
		while (Holding) {
			await sleep(1000)
		}
		showBoth(`Resuming ${what}`)
	}
}

function specificLocalTime(when : Date)
{
	return when.toLocaleTimeString('en-GB')	// en-GB gets a 24hour format, but amazingly local time!
}

function currentLocalTime()
{
	return specificLocalTime(new Date())
}

function showTopLine(text : string)
{
	text = currentLocalTime()+' '+text
	// Save cursor, Home cursor, text, Erase to end of line, Restore cursor
	process.stderr.write('\u001b7'+'\u001b[H'+text+'\u001b[K'+'\u001b8')	
}

function showSecondLine(text : string)
{
	const save = '\u001b7'
	const home = '\u001b[H'
	const down = '\u001bD'
	const erase = '\u001b[K'
	const restore = '\u001b8'
	text = currentLocalTime()+' '+text
	// Save cursor, Home cursor, Down line, text, Erase to end of line, Restore cursor
	//process.stderr.write('\u001b7'+'\u001b[H'+'\u001bD'+text+'\u001b[K'+'\u001b[H'+'\u001bD'+'\u001bD'+'\u001b[K'+'\u001b8')
	process.stderr.write(save+home+down+text+erase+home+down+down+erase+restore)
}

function showError(text : string)
{
	//process.stderr.clearLine(1);
	console.error('\u001b[K'+currentLocalTime()+' '+text)
}

function showLog(text : string)
{
	printStatus(text)
	console.log(currentLocalTime()+' '+text)
}

function showBoth(text : string)
{
	showLog(text)
	showError(text)
}

var pendingStatus:string|undefined = undefined

async function statusPrinter() {
	await sleep(500)
	process.stderr.write(pendingStatus+'\u001b[K\r');	// Erase to end of line then return
//	process.stderr.clearLine(1); process.stderr.cursorTo(0);
	pendingStatus = undefined
}

function printStatus(text: string) {
	if (!pendingStatus) statusPrinter()
	pendingStatus = text
}

const hexToBytes = (hexString: string): Reference => {
  return Utils.hexToBytes(hexString)
}

const bytesToHex = (data: Uint8Array | undefined): string => {
  if (!data) return "*undefined*"
  return Utils.bytesToHex(data)
}

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

async function statusDelay(sec: number) {
	while (sec > 0) {
		printStatus(`Delaying ${sec} seconds...`)
		await sleep(1000)
		sec--
	}
}

var mime = require('mime-types')

function contentType(path:string):string {
	var mimeType = mime.lookup(path)
	if (!mimeType) {
		mimeType = mime.lookup('.bin')
		if (!mimeType) mimeType = 'application/octet-stream'
	}
	return mime.contentType(mimeType)
}

var utf8ArrayToStr = (function () {
    var charCache = new Array(128);  // Preallocate the cache for the common single byte chars
    var charFromCodePt = String.fromCodePoint || String.fromCharCode;
    var result = Array<string>();
	const hasFromCodePoint = (typeof String.fromCodePoint == 'function');

    return function (array: Uint8Array) {
        var codePt, byte1;
        var buffLen = array.length;

        result.length = 0;

        for (var i = 0; i < buffLen;) {
            byte1 = array[i++];

            if (byte1 <= 0x7F) {
                codePt = byte1;
            } else if (byte1 <= 0xDF) {
                codePt = ((byte1 & 0x1F) << 6) | (array[i++] & 0x3F);
            } else if (byte1 <= 0xEF) {
                codePt = ((byte1 & 0x0F) << 12) | ((array[i++] & 0x3F) << 6) | (array[i++] & 0x3F);
            } else if (hasFromCodePoint) {
                codePt = ((byte1 & 0x07) << 18) | ((array[i++] & 0x3F) << 12) | ((array[i++] & 0x3F) << 6) | (array[i++] & 0x3F);
            } else {
                codePt = 63;    // Cannot convert four byte code points, so use "?" instead
                i += 3;
            }

            result.push(charCache[codePt] || (charCache[codePt] = charFromCodePt(codePt)));
        }

        return result.join('');
    };
})();


async function executeBinaryAPI(URL : string, API : string, params : string = '', method : string = 'get', headers : any = {}, body : any = '')
{
	if (params != '') params = '/'+params
	
	var actualURL = URL+'/'+API+params
	var doing = method+' '+actualURL

	await waitForHold(doing)

	var start = new Date().getTime()
	
	try
	{
		//showError('Starting '+doing)
		//var response = await axios({ method: method, url: actualURL, headers: headers, data: body })
		var response = await axios({ method: method, url: actualURL,
										headers: headers, data: body,
										responseType: 'arraybuffer',
										httpAgent: httpAgent,
										httpsAgent: httpsAgent,
										maxContentLength: Infinity,
										maxBodyLength: Infinity })
	}
	catch (err:any)
	{
		var elapsed = Math.trunc((new Date().getTime() - start)/100+0.5)/10.0
		if (err.response)
		{	//showError(actualURL)
			showError(doing+' '+elapsed+'s response error '+err+' with '+JSON.stringify(err.response.data))
			//showError(JSON.stringify(err.response.data))
		} else if (err.request)
		{	showError(doing+' '+elapsed+'s request error '+err)
			//showError(JSON.stringify(err.request))
		} else
		{	showError(doing+' '+elapsed+'s other error '+err)
			//showError(JSON.stringify(err))
		}
		throw(err);
		return void(0)
	}
	var elapsed = Math.trunc((new Date().getTime() - start)/1000+0.5)
	//showError(actualURL+' response.data='+JSON.stringify(response.data))
	//showError(doing+' '+elapsed+' response.data='+JSON.stringify(response.data))

	return response.data
}

async function executeAPI(URL : string, API : string, params : string = '', method : string = 'get', headers : any = {}, body : any = '', ignoreErrors : boolean = false)
{
	if (params != '') params = '/'+params
	
	var actualURL = URL+'/'+API+params
	var doing = method+' '+actualURL

	await waitForHold(doing)

	var start = new Date().getTime()
	
	try
	{
		//showError('Starting '+doing)
		//var response = await axios({ method: method, url: actualURL, headers: headers, data: body })
		var response = await axios({ method: method, url: actualURL,
										headers: headers, data: body,
										httpAgent: httpAgent,
										httpsAgent: httpsAgent,
										maxContentLength: Infinity,
										maxBodyLength: Infinity })
	}
	catch (err:any)
	{
		if (!ignoreErrors) {
			var elapsed = Math.trunc((new Date().getTime() - start)/100+0.5)/10.0
			if (err.response)
			{	//showError(actualURL)
				showError(doing+' '+elapsed+'s response error '+err+' with '+JSON.stringify(err.response.data))
				//showError(JSON.stringify(err.response.data))
			} else if (err.request)
			{	showError(doing+' '+elapsed+'s request error '+err)
				//showError(JSON.stringify(err.request))
			} else
			{	showError(doing+' '+elapsed+'s other error '+err)
				//showError(JSON.stringify(err))
			}
		}
		throw(err);
		return void(0)
	}
	var elapsed = Math.trunc((new Date().getTime() - start)/1000+0.5)
	//showError(actualURL+' response.data='+JSON.stringify(response.data))
	//showError(doing+' '+elapsed+' response.data='+JSON.stringify(response.data))

	return response.data
}



type failure = {
	when: string,
	type: string,
	prefix: string,
	reference: string,
	err: string,
}

let failures: Array<failure> = [];

function addFailure(type: string, prefix: string, reference: string, err: string) {
	failures.push({when: currentLocalTime(), type: type, prefix: prefix, reference: reference, err: err})
}

function showFailures() {
	for (const f of failures) {
		showBoth(`${f.when} ${f.type} ${f.prefix} ${f.reference} ${f.err}`)
	}
}

const RetrievableMax = 200
const semaphorePin = new Semaphore(1);
const semaphoreGetContent = new Semaphore(20);
const semaphorePutContent = new Semaphore(20);



async function getPin(reference: string) : Promise<boolean> {
	try {
//async function executeAPI(URL : string, API : string, params : string = '', method : string = 'get', headers : any = {}, body : any = '', ignoreError : undefined|boolean)
		const pin = await executeAPI(beeUrl, 'pins', `${reference}`, 'get', {}, '', true)	// 404 error expected on this
		if (pin) {
			//showBoth(`Existing pin for ${reference}`)
			return true
		}
	} catch (err) {
		//showBoth(`getPin(${reference}) got ${err}`)
	}
	return false
}

async function createPin(reference: string) : Promise<boolean> {
	try {
		const pin = await executeAPI(beeUrl, 'pins', `${reference}`, 'post')
		//showBoth(`Created Pin for ${reference}`)
		if (pin) return true
	} catch (err) {
		showBoth(`createPin(${reference}) got ${err}`)
	}
	return false
}

async function pinReference(reference: string, type: string, path: string) : Promise<boolean> {
	const [value, release] = await semaphorePin.acquire();
	try {
		printStatus(`Checking pin ${type} ${path} at ${reference}`)
		if (await getPin(reference)) return true
		printStatus(`Actually pinning ${type} ${path} at ${reference}`)
		const result = createPin(reference)
		if (await result) {
			showLog(`Successfully pinned ${type} ${path} at ${reference}`)
		} else {
			showBoth(`Failed to pin ${type} ${path} at ${reference}`)
		}
		return result
	}
	finally {
		release()
	}
}



const zeroAddress = '0000000000000000000000000000000000000000000000000000000000000000';

type pendingFile = {
	prefix: string,
	reference: string,
	indent: string,
}

type pendingNode = {
	node: MantarayNode,
	prefix: string,
	indent: string,
	excludes: string[]|undefined,
}

let pendingFiles: Array<pendingFile> = [];
let pendingValues: Array<pendingNode> = [];
let pendingNodes: Array<pendingNode> = [];
let nodesRunning = 0;
let valuesRunning = 0;
let filesRunning = 0;
let nodesActive = 0;




const queueing = true



async function checkFile(entry: string, prefix: string, indent: string) {
	try {
		const content = await downloadData(entry, prefix)
		showLog(`${indent}${prefix} got ${content.length} bytes`)
		await pinReference(entry, 'file', prefix)
	} catch (err: any) {
		showLog(`checkFile:downloadData(${prefix}) err ${err}`)
		addFailure('file', prefix, entry, err.toString())
	}
}

async function processNodeOrValue(storageLoader: StorageLoader, what: string, manifestOnly: Boolean, loadFiles: Boolean, saveFiles: Boolean) : Promise<Boolean>
{
	var node: pendingNode | undefined
	if (pendingNodes.length > 0 && !loadFiles) {
		node = pendingNodes.shift()
	} else if (pendingValues.length > 0 && (pendingFiles.length < 200 || pendingNodes.length == 0)) {
		node = pendingValues.shift()
	} else if (pendingNodes.length > 0) {
		node = pendingNodes.shift()
	}
	if (node && !exitRequested) {
		var running = true
		const timeout = setTimeout(async () => {
						if (!exitRequested && !Holding && nodesRunning < RetrievableMax) {
							nodesRunning++
							while (running)
								if (!await processNodeOrValue(storageLoader, what, manifestOnly, loadFiles, saveFiles))
									break
							nodesRunning--
						}
					}, 6000);	// Longer than 6 seconds, spawn a parallel thread
		nodesActive++
		await printAllForks(storageLoader, node.node, node.node.getEntry, node.prefix, node.indent, what, undefined, node.excludes, manifestOnly, loadFiles, saveFiles);
		clearTimeout(timeout)
		nodesActive--
		running = false
		return true
	}
	return false
}

async function processNodes(storageLoader: StorageLoader, what: string, manifestOnly: Boolean, loadFiles: Boolean, saveFiles: Boolean)
{
	var retries = 5
	const start = new Date().getTime()
	var elapsed = Math.trunc((new Date().getTime() - start)/1000+0.5)
	while (!exitRequested && ((elapsed < 60 && nodesActive > 0) || retries-- > 0)) {	// Require 60 seconds before allowing termination
		while (pendingNodes.length > 0 || pendingValues.length > 0) {
			await processNodeOrValue(storageLoader, what, manifestOnly, loadFiles, saveFiles)
			if (exitRequested) { pendingNodes = [] }
		}
		if (!exitRequested) await sleep(1000)
		else printStatus(`processNodes:${nodesRunning} running, ${pendingNodes.length}+${pendingValues.length} pending`)
		elapsed = Math.trunc((new Date().getTime() - start)/1000+0.5)
	}
	nodesRunning--;
	if (exitRequested && nodesRunning > 0) printStatus(`processNodes exiting, ${nodesRunning} still running`)
}

async function processValue(storageLoader: StorageLoader, what: string, manifestOnly: Boolean, loadFiles: Boolean, saveFiles: Boolean) : Promise<Boolean>
{
	var node: pendingNode | undefined
	if (pendingValues.length > 0) {
		node = pendingValues.shift()
	}
	if (node && !exitRequested) {
		var running = true
		const timeout = setTimeout(async () => {
						if (!exitRequested && !Holding && valuesRunning < RetrievableMax) {
							valuesRunning++
							while (running)
								if (!await processValue(storageLoader, what, manifestOnly, loadFiles, saveFiles))
									break
							valuesRunning--
						}
					}, 6000);	// Longer than 6 seconds, spawn a parallel thread
		nodesActive++
		await printAllForks(storageLoader, node.node, node.node.getEntry, node.prefix, node.indent, what, undefined, node.excludes, manifestOnly, loadFiles, saveFiles);
		clearTimeout(timeout)
		nodesActive--
		running = false
		return true
	}
	//else showBoth(`processNode dequeued null (${node}) or exitRequested (${exitRequested})`)
	return false
}

async function processValues(storageLoader: StorageLoader, what: string, manifestOnly: Boolean, loadFiles: Boolean, saveFiles: Boolean)
{
	const start = new Date().getTime()
	var elapsed = Math.trunc((new Date().getTime() - start)/1000+0.5)
	while (nodesRunning > 0 || pendingValues.length > 0) {
		while (pendingValues.length > 0) {
			await processValue(storageLoader, what, manifestOnly, loadFiles, saveFiles)
			if (exitRequested) { pendingValues = [] }
		}
		if (!exitRequested) await sleep(1000)
		else printStatus(`processValues:${nodesRunning} running, ${pendingValues.length} pending`)
		await sleep(100)
		elapsed = Math.trunc((new Date().getTime() - start)/1000+0.5)
	}
	valuesRunning--;
	if (exitRequested && valuesRunning > 0) printStatus(`processValues exiting, ${valuesRunning} still running`)
	//else showBoth(`processValues exiting after ${elapsed} seconds, ${pendingValues.length} pendingNodes ${valuesRunning} still running`)
}

async function processFile(what: string, loadFiles: Boolean, saveFiles: Boolean) : Promise<Boolean>
{
	if (pendingFiles.length > 0) {
		let file = pendingFiles.shift()
		if (file && !exitRequested) {
			var running = true
			const timeout = setTimeout(async () => {
							if (!exitRequested && !Holding && filesRunning < RetrievableMax) {
								filesRunning++
								while (running)
									if (!await processFile(what, loadFiles, saveFiles))
										break
								filesRunning--
							}
						}, 6000);	// Longer than 6 seconds, spawn a parallel thread
			await checkFile(file.reference, file.prefix, file.indent);
			clearTimeout(timeout)
			running = false
			return true
		}
	}
	return false
}

async function processFiles(what: string, loadFiles: Boolean, saveFiles: Boolean)
{
	while (nodesRunning > 0 || pendingFiles.length > 0) {
		while (pendingFiles.length > 0) {
			await processFile(what, loadFiles, saveFiles)
			if (exitRequested) pendingFiles = []
		}
		if (exitRequested) printStatus(`processFiles waiting for ${nodesRunning} nodes`)
		await sleep(100);
	}
	filesRunning--
}





async function printAllForks(storageLoader: StorageLoader, node: MantarayNode, reference: Reference|undefined, prefix: string, indent: string, what: string, filter: string|undefined, excludes: string[]|undefined, manifestOnly: Boolean, loadFiles: Boolean, saveFiles: Boolean): Promise<void> {

	if (!reference) return
	
	if (exitRequested) return
	
	try {
		await node.load(storageLoader, reference)
		await pinReference(bytesToHex(reference), 'node', prefix)	// Only pin it after a successful load!
	}
	catch (err: any) {
		var badAddr = bytesToHex(reference)
		showBoth(`printAllForks: Failed to load ${prefix} address ${badAddr} ${err}`);
		addFailure('node', prefix, badAddr, err.toString())
		return
	}

	var types = "";
	if (node.isValueType()) types = types + "Value ";
	if (node.isEdgeType()) types = types + "Edge ";
	if (node.isWithPathSeparatorType()) types = types + "Separator ";
	if (node.IsWithMetadataType()) types = types + "Meta ";
	
	var address = node.getContentAddress;
	var addrString = "";
	if (address) addrString = bytesToHex(address);
	//showLog(`${indent}type:x${Number(node.getType).toString(16)} ${types} prefix:${prefix} content:${addrString}`)

	showLog(`${indent}type:x${Number(node.getType).toString(16)} ${types} prefix:${prefix} content:${addrString}`);

	//var reference = bytesToHex(node.getReference)
	//if (reference != zeroAddress)
	//	console.log(`${indent}reference:${reference}`)
	var obfuscation = bytesToHex(node.getObfuscationKey)
	//if (obfuscation != zeroAddress)
	//	showLog(`${indent}obfuscation:${obfuscation}`)


	var entry = bytesToHex(node.getEntry)
	if (entry != zeroAddress) {
		showLog(`${indent}type:x${Number(node.getType).toString(16)} ${types} prefix:${prefix} entry:${entry}`);
		if (loadFiles && what && what != "") {
			if (queueing)
				pendingFiles.push({prefix: prefix, reference: entry, indent: indent});
			else await checkFile(entry, prefix, indent)
		}
	}

	if (node.IsWithMetadataType() && node.getMetadata) {
		var meta = ""
		for (const [key, value] of Object.entries(node.getMetadata)) {
			meta = meta + key + ":" + value + " "
		}
		showLog( `${indent}${prefix} metadata: ${meta}` )
	}
	
	if (exitRequested) return

	if (!node.forks) return
	for (const [key, fork] of Object.entries(node.forks)) {
		var newPrefix = prefix+utf8ArrayToStr(fork.prefix)
		if (filter && filter != '') {
			const checkLen = Math.min(newPrefix.length, filter.length)
			if (newPrefix.slice(0,checkLen) == filter.slice(0,checkLen)) {
				if (checkLen < filter.length) {
					showLog(`printAllForks:recursing ${newPrefix} for ${filter}`)
					await printAllForks(storageLoader, fork.node, fork.node.getEntry, newPrefix, indent+'  ', what, filter, excludes, manifestOnly, loadFiles, saveFiles)
					continue
				}
				else showBoth(`printAllForks:Satisfied ${filter} with ${newPrefix} ${bytesToHex(fork.node.getEntry)}`)
			} else {
				showLog(`printAllForks:Ignoring ${newPrefix} NOT ${filter}`)
				continue
			}
		}
		if (excludes && excludes.length > 0) {
			let found = false;
			for (const exclude of excludes) {
				if (newPrefix.length >= exclude.length) {
					if (newPrefix.slice(0,exclude.length) == exclude) {
						showBoth(`printAllForks:Excluding ${newPrefix}`)
						found = true
						break
					}
				}
			}
			if (found) continue
		}
		if (queueing) {
			if (fork.node.isValueType() && !fork.node.isEdgeType()) {	// Handle value (non-edge) nodes first to resolve files quicker
				pendingValues.push({node: fork.node, prefix: newPrefix, indent: indent+'  ', excludes: excludes})	// Enough pendingFiles backlog, queue to the end
			}
			else pendingNodes.push({node: fork.node, prefix: newPrefix, indent: indent+'  ', excludes: excludes});

		} else
			await printAllForks(storageLoader, fork.node, fork.node.getEntry, newPrefix, indent+'  ', what, filter, excludes, manifestOnly, loadFiles, saveFiles)
	}
	node.forks = {}	// empty forks to remove node references
}


async function dumpManifest(storageLoader: StorageLoader, reference: string, what: string, filter: string|undefined = undefined, excludes: string[]|undefined, manifestOnly = false, loadFiles: Boolean = true, saveFiles: Boolean = false) : Promise<void> {

	var start = new Date().getTime()
	showLog(`dumpManifest:${what} from ${reference} ${filter}`)

	let node = new MantarayNode()
	const result = printAllForks(storageLoader, node, hexToBytes(reference), '', '', what, filter, excludes, manifestOnly, loadFiles, saveFiles)
	node = new MantarayNode()	// Remove reference to allow gc to collect the trie
	await result

	if (queueing) {
	let promiseArray = [];
	for (let i = 0; i < 20; i++) {
		nodesRunning++
		promiseArray.push(processNodes(loadFunction, what, manifestOnly, loadFiles, saveFiles))
	}

	for (let i = 0; i < 20; i++) {
		valuesRunning++
		promiseArray.push(processValues(loadFunction, what, manifestOnly, loadFiles, saveFiles))
	}

	for (let i = 0; i < 20; i++) {
		filesRunning++
		promiseArray.push(processFiles(what, loadFiles, saveFiles))
	}
	
	await Promise.all(promiseArray)
	var lastWaitingText = ''
	while (nodesRunning > 0 || valuesRunning > 0 || filesRunning > 0) {
		const text = `Waiting for ${nodesRunning} nodes, ${valuesRunning} values, and/or ${filesRunning} files`
		if (text != lastWaitingText) printStatus(text)
		lastWaitingText = text
		await sleep(1000)
	}
	}

	var elapsed = Math.trunc((new Date().getTime() - start)/1000+0.5)
	showBoth(`dumpManifest:${what} ${filter} in ${elapsed} seconds`)
	
	return result
}

async function uploadData(content: Uint8Array | string, what: string, pin: boolean) : Promise<Reference> {
	await waitForHold(`uploadData(${what})`)
	const retryDelay = 15	// 15 second delay before doing a retry
	const timeout = 10000	// 10 second timeout per request, note this is *4 for retries
	var reference: string
	const [value, release] = await semaphorePutContent.acquire();
	var start = new Date().getTime()
	try {
		//reference = (await bee.uploadData(batchID, content, {pin: pin, tag: tagID, timeout: timeout, fetch: fetch})).reference
		reference = (await executeAPI(beeUrl, 'bytes', '', 'POST', {"Content-Type": "application/octet-stream", "swarm-postage-batch-id": batchID, "swarm-tag": `${tagID}`, "swarm-pin": `${pin}`}, content)).reference
		if (uploadDelay > 0) await sleep(uploadDelay)
	}
	catch (err) {
		showBoth(`uploadData ${what} ${content.length} bytes failed with ${err}`)
		await statusDelay(retryDelay)
		printStatus(`uploadData RETRYING ${what} ${content.length} bytes after ${err}`)
		try {
			//reference = (await bee.uploadData(batchID, content, {pin: pin, tag: tagID, timeout: timeout*4, fetch: fetch})).reference	// Quadruple the timeout for the retry
			reference = (await executeAPI(beeUrl, 'bytes', '', 'POST', {"Content-Type": "application/octet-stream", "swarm-postage-batch-id": batchID, "swarm-tag": `${tagID}`, "swarm-pin": `${pin}`}, content)).reference
		}
		catch (err) {
			showBoth(`uploadData ${what} RETRY ${content.length} bytes failed with ${err}`)
			throw err
		}
	}
	finally {
		release()
	}
	var elapsed = Math.trunc((new Date().getTime() - start)/100+0.5)/10.0
	if (elapsed >= timeout/4/1000)	// Alert the user if we are >25% of timeout value
		showError(`uploadData ${what} ${content.length} bytes took ${elapsed}s, ref:${reference}`)
	showLog(`Upload ${what} ${content.length} bytes => ${reference}`)
	return hexToBytes(reference)
}

const saveFunction = async (data: Uint8Array): Promise<Reference> => {
	await waitForHold(`saveFunction(${data.length})`)
	return uploadData(data, `saveFunction(${data.length})`, true)
//	try {
//		const hexRef = await bee.uploadData(batchID, data, {pin: true, tag: tagID})
//		if (uploadDelay > 0) await sleep(uploadDelay)
//		return hexToBytes(hexRef)
//	}
//	catch (err) {
//		showBoth(`saveFunction ${data.length} bytes failed with ${err}`)
//		await statusDelay(15)
//		try {
//			const hexRef = await bee.uploadData(batchID, data, {pin: true, tag: tagID})
//			return hexToBytes(hexRef)
//		}
//		catch (err) {
//			showBoth(`saveFunction RETRY ${data.length} bytes failed with ${err}`)
//			throw err
//		}
//	}
}

async function downloadData(address: string, what : string = "*unknown*") : Promise<Uint8Array> {
	await waitForHold(`downloadData(${what})`)
	const [value, release] = await semaphoreGetContent.acquire();
	var start = new Date().getTime()
	var bytes = 0
	var content
	try {
		//content = await bee.downloadData(address)
		content = await executeBinaryAPI(beeUrl, 'bytes', address)
		bytes = content.length
		if (bytes == 0) throw new Error('Zero Bytes Read');
		//var content = await executeAPI(beeUrl, 'bytes', 'get', address)
	}
	catch (err) {
		const elapsed = Math.trunc((new Date().getTime() - start)/100+0.5)/10.0
		showBoth(`downloadData ${what} ${address} failed in ${elapsed}s with ${err}`)
		throw err
	}
	finally {
		release()
	}
	const elapsed = Math.trunc((new Date().getTime() - start)/100+0.5)/10.0
	if (elapsed >= 5)
		showError(`downloadData(${what} ${address}) took ${elapsed}s for ${bytes} bytes`)
	return content
}

const loadFunction = async (address: Reference): Promise<Uint8Array> => {
	await waitForHold(`loadFunction(${bytesToHex(address)})`)
	return downloadData(bytesToHex(address), "loadFunction")
//	var start = new Date().getTime()
//	var bytes = 0
//	var r
//	try {
//		r = await bee.downloadData(bytesToHex(address))
//		bytes = r.length
//		if (bytes == 0) throw new Error('Zero Bytes Read');
//	}
//	catch (err) {
//		const elapsed = Math.trunc((new Date().getTime() - start)/100+0.5)/10.0
//		showBoth(`loadFunction ${bytesToHex(address)} failed in ${elapsed}s with ${err}`)
//		throw err
//	}
//	var elapsed = Math.trunc((new Date().getTime() - start)/100+0.5)/10.0
//	if (elapsed >= 1)
//		showError(`loadFunction(${bytesToHex(address)}) took ${elapsed}s`)
//	return r;
}

async function doit(rootReference: string) {

function CtrlC() {
        if (exitRequested) {
                showLog("shutting down from SIGINT (Crtl-C)")
                showError( "shutting down from SIGINT (Crtl-C)" );
                process.exit();
        } else {
                exitRequested = true
                showLog( "shutdown requested from SIGINT (Crtl-C)" );
                showError( "shutdown requested from SIGINT (Crtl-C)" );
        }
}

process.on( "SIGINT", function() { CtrlC() } )

const readline = require('readline')
readline.emitKeypressEvents(process.stdin)
process.stdin.setRawMode(true)
process.stdin.on('keypress', (str, key) => {
	if (key.ctrl && key.name === 'c') {
		CtrlC()
	} else {
		if (key.ctrl) showBoth(`You pressed control-${key.name}`)
		else {
			//showBoth(`You pressed the "${str}" key`)
			if (str == 'H' && !Holding) {
				Holding = true
				showBoth("Initiating HOLD")
			} else if (str == 'R' && Holding) {
				Holding = false
				showBoth("Resuming from HOLD")
			} else showBoth(`Use H for HOLD and R for RESUME, you pressed "${str}"`)
		}	
	}
})


//	For uploading a straight directory set with an index.html
//	const rootNode = await newManifest(saveFunction, srcDir, "index.html")
//	showBoth(`Uploaded ${srcDir} as ${rootNode}`)
	
//	For uploading a Wikipedia archive with A/index
	//const rootNode = await newManifest(saveFunction, srcDir, "A/index")
	//showBoth(`Uploaded ${srcDir} as ${rootNode}`)
	
//	You can define your own root reference for dumping purposes if desired
//	const rootNode = "9aafea948007399891290fc3b294fdfbbf7f51313111dd20ba2bb6ff2a1ecd27"

//	This will dump out the uploaded manifest for diagnostic purposes
	await dumpManifest(loadFunction, rootReference, "manifest", undefined, undefined, false, true, false)
	
	showBoth(`FAILURES:`)
	showFailures()
	showBoth(`All DONE!`)

//	showBoth(`TAG information may be viewed using curl ${beeUrl}/tags/${tagID} | jq`)
//	showBoth(`View your archive at ${beeUrl}/bzz/${rootNode}`)
	process.exit()
}

try {
	doit(process.argv[2])
} catch (err) {
	showBoth(`${err}`)

}
