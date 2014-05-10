/**
*
* Copyright 2014 Darrell Taylor.
* Original Copyright 2014 Jonathan Leach.
*
* Originally forked from : https://github.com/leachj/nodered-zwave
* which is where all the heavy lifting was done, I just tweaked it.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
**/

// If you use this as a template, replace IBM Corp. with your own name.

// Sample Node-RED node file

// Require main module
var RED = require(process.env.NODE_RED_HOME+"/red/red");
var OpenZWave = require('openzwave');
var util = require("util");

// The main node definition - most things happen in here
function ZwaveOutNode(n) {
	// Create a RED node
	RED.nodes.createNode(this,n);
	
	// Store local copies of the node configuration (as defined in the .html)
	this.port = n.port;
	this.nodeId = n.nodeid;
	
	var node = this;
	var zwave = zwavePool.get(this.port);
	
	this.on("input", function(msg) {
			
			var value = msg.payload;
			var node = msg.nodeId||this.nodeId

			this.log('[zwave] setting '+node+' to '+value);

			if(value == "true"){
				zwave.switchOn(node);
			} else if(value == "false"){
				zwave.switchOff(node)
			} else if(msg.topic=='settings'){
				var parts = value.split('|');
				zwave.setValue(node,parts[0],parts[1],parts[2]);
			} else {
				zwave.setLevel(node,value);
			}
	});
	
	this.on("close", function() {
			try 
			{
				zwave.disconnect();
			}
			catch(err)
			{ };
	});
	
}

function ZwaveInNode(n) {
	// Create a RED node
	RED.nodes.createNode(this,n);
	
	// Store local copies of the node configuration (as defined in the .html)
	this.port = n.port;
	this.nodeId = n.nodeid;
	
	var node = this;
	var nodes = [];
	
	var zwave = zwavePool.get(this.port);
	
	zwave.on('notification', function(nodeid, notif) 
		{
			var msg = { 
				topic:'zwave',
				nodeid:nodeid,
				notif:notif
				};

			switch (notif) {
			case 0:
				msg.payload = 'message complete';
				break;
			case 1:
				msg.payload = 'timeout';
				break;
			case 2:
				msg.payload = 'nop';
				break;
			case 3:
				msg.payload = 'node awake';
				break;
			case 4:
				msg.payload = 'node sleep';
				break;
			case 5:
				msg.payload = 'node dead';
				break;
			case 6:
				msg.payload = 'node alive';
				break;
			}
			node.log("[zwave] "+msg.payload);
			
			node.send(msg);
		});
	
	
	zwave.on('node added', function(nodeid) {
			nodes[nodeid] = {
				manufacturer: '',
				manufacturerid: '',
				product: '',
				producttype: '',
				productid: '',
				type: '',
				name: '',
				loc: '',
				classes: {},
				ready: false,
			};

			node.send({
					topic:'zwave',
					nodeid:nodeid,
					payload:'node added'
			})
	});
	
	zwave.on('value added', function(nodeid, comclass, value) {
			if (!nodes[nodeid]['classes'][comclass])
				nodes[nodeid]['classes'][comclass] = {};
			nodes[nodeid]['classes'][comclass][value.index] = value;

			node.send({
					topic:'zwave',
					nodeid:nodeid,
					comclass:comclass,
					value:value,
					payload:'value added'
			})

	});
	
	zwave.on('value changed', function(nodeid, comclass, value) {
			if (nodes[nodeid]['ready']) {
				node.log('node%d: changed: %d:%s:%s->%s', nodeid, comclass,
					value['label'],
					nodes[nodeid]['classes'][comclass][value.index]['value'],
					value['value']);
			}
			nodes[nodeid]['classes'][comclass][value.index] = value;

			node.send({
					topic:'zwave',
					nodeid:nodeid,
					comclass:comclass,
					value:value,
					payload:'value changed'
			})

	});
	
	zwave.on('value removed', function(nodeid, comclass, index) {
			if (nodes[nodeid]['classes'][comclass] &&
				nodes[nodeid]['classes'][comclass][index])
			delete nodes[nodeid]['classes'][comclass][index];
	});
	
	zwave.on('node ready', function(nodeid, nodeinfo) {
			nodes[nodeid]['manufacturer'] = nodeinfo.manufacturer;
			nodes[nodeid]['manufacturerid'] = nodeinfo.manufacturerid;
			nodes[nodeid]['product'] = nodeinfo.product;
			nodes[nodeid]['producttype'] = nodeinfo.producttype;
			nodes[nodeid]['productid'] = nodeinfo.productid;
			nodes[nodeid]['type'] = nodeinfo.type;
			nodes[nodeid]['name'] = nodeinfo.name;
			nodes[nodeid]['loc'] = nodeinfo.loc;
			nodes[nodeid]['ready'] = true;
			console.log('node%d: %s, %s', nodeid,
				nodeinfo.manufacturer ? nodeinfo.manufacturer
				: 'id=' + nodeinfo.manufacturerid,
				nodeinfo.product ? nodeinfo.product
				: 'product=' + nodeinfo.productid +
				', type=' + nodeinfo.producttype);
			console.log('node%d: name="%s", type="%s", location="%s"', nodeid,
				nodeinfo.name,
				nodeinfo.type,
				nodeinfo.loc);
			for (comclass in nodes[nodeid]['classes']) {
				switch (comclass) {
				case 0x25: // COMMAND_CLASS_SWITCH_BINARY
				case 0x26: // COMMAND_CLASS_SWITCH_MULTILEVEL
					zwave.enablePoll(nodeid, comclass);
					break;
				}
				var values = nodes[nodeid]['classes'][comclass];
				console.log('node%d: class %d', nodeid, comclass);
				for (idx in values)
					console.log('node%d:   [%d]%s=%s', nodeid, idx, values[idx]['label'], values[idx]['value']);
			}

			node.send({
					topic:'zwave',
					nodeid:nodeid,
					nodeinfo:nodeinfo,
					payload:'node ready'
			})

	});
	
	this.on("close", function() {
			try 
			{
				zwave.disconnect();
			}
			catch(err)
			{ };
	});
	
}




var zwavePool = function() {
	var connections = {};
	return {
		get:function(port) 
		{
			var id = port;
			
			if (!connections[id]) 
			{
				connections[id] = function() 
				{
					var zwave = new OpenZWave(port);
					
					zwave.connect();
					
					zwave.on('scan complete', function() 
						{
							util.log('[zwave] scan complete.');
						});
					
					return zwave;
				}();
			}
			
			return connections[id];
		}
	}
}();




// Register the node by name. This must be called before overriding any of the
// Node functions.
RED.nodes.registerType("zwave out",ZwaveOutNode);
RED.nodes.registerType("zwave in",ZwaveInNode);
