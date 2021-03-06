// Gmail API credentials
var gmailClientId = '166859819073-rv7t4945r8toh7ek9ab99enelke8mtbb.apps.googleusercontent.com';
var gmailApiKey = 'AIzaSyBYQPC4-1SENmvv-0TlM18X6ay98s0A0Lo';
var gmailScopes = 'https://www.googleapis.com/auth/gmail.readonly';

function initializeGmailAuthSequence() {
  //oauth2 auth
  chrome.identity.getAuthToken(
    {'interactive': true},
    function(){
      //load Google's javascript client libraries
      window.gapi_onload = authorize;
      loadScript('https://apis.google.com/js/client.js');
    }
  );
}

function loadScript(url){
  var request = new XMLHttpRequest();
  request.onreadystatechange = function(){
    if(request.readyState !== 4) {
      return;
    }
    if(request.status !== 200){
      return;
    }
    eval(request.responseText);
  };
  request.open('GET', url);
  request.send();
}

function authorize(){
  gapi.auth.authorize(
    {
      client_id: gmailClientId,
      immediate: true,
      scope: 'https://www.googleapis.com/auth/gmail.readonly'
    },
    function(){
      gapi.client.load('gmail', 'v1', gmailAPILoaded);
    }
  );
}

function gmailAPILoaded(){
    checkLocalTokens();
    processInbox();
}

function processInbox() {
  // Look for most recently processed email id in local storage
  // If it's there, initialize a variable to its value in order to
  // compare current emails against - only process emails that haven't
  // already been processed
  var newestEmailId = null;
  chrome.storage.local.get('newestEmailId', function(emailIdObj) {
    console.log("Newest email ID:", emailIdObj['newestEmailId']);
    if (emailIdObj['newestEmailId'] !== undefined) {
      newestEmailId = emailIdObj['newestEmailId'];
    }
  });
  var request = gapi.client.gmail.users.messages.list({
    'userId': 'me',
    'labelIds': 'INBOX',
    'q': 'spotify is now available',
    'maxResults': 10
  });
  request.execute(function(response) {
    console.log("Gmail query response object:", response);
    for (var i=0; i < response.messages.length; i++) {
      var messageObj = response.messages[i];
      processGmailMessageObj(messageObj, i, newestEmailId);
    }
  });
}

// Process given email
// 1. Extract deep link
// 2. Extract album id
// 3. Add album's songs to Email Digest playlist
function processGmailMessageObj(messageObj, index, newestEmailId) {
  // Wait 15 seconds between each email processing
  setTimeout(function() { 
    console.log(messageObj);
    var x = (messageObj.id == newestEmailId);
    console.log(x);
    console.log(messageObj.id);
    // Check if this email has already been processed
    if (messageObj.id > newestEmailId || newestEmailId === null) {
      chrome.storage.local.set({
        'newestEmailId': messageObj.id
      }, function(){
        chrome.storage.local.get('newestEmailId', function(response){
          console.log(index, response);
        });
      });
      var messageRequest = gapi.client.gmail.users.messages.get({
        'userId': 'me',
        'id': messageObj.id
      });
      console.log(messageRequest);
      // Get deep links from Spotify messages
      messageRequest.execute(getMessageLink);
    }
    console.log("Waiting 15 secs to process next email. Hang tight...");
  }, 15000*(index+1));
}

function getHeader(headers, index) {
  var header = '';
  $.each(headers, function(){
    if(this.name === index){
      header = this.value;
    }
  });
  return header;
}

function getBody(message) {
  var encodedBody = '';
  if(typeof message.parts === 'undefined')
  {
    encodedBody = message.body.data;
  }
  else
  {
    encodedBody = getHTMLPart(message.parts);
  }
  encodedBody = encodedBody.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  return decodeURIComponent(escape(window.atob(encodedBody)));
}

function getHTMLPart(arr) {
  for(var x = 0; x <= arr.length; x++)
  {
    if(typeof arr[x].parts === 'undefined')
    {
      if(arr[x].mimeType === 'text/html')
      {
        return arr[x].body.data;
      }
    }
    else
    {
      return getHTMLPart(arr[x].parts);
    }
  }
  return '';
}

function getMessageLink(message) {
	// Check to make sure message is from Spotify
	if (getHeader(message.payload.headers, 'From').indexOf("Spotify") > -1) {
		var rawHTMLBody = getBody(message.payload);
		var parser = new DOMParser();
		var bodyDOM = parser.parseFromString(rawHTMLBody, "text/html");
		var deepLink = bodyDOM.links[1].href;
		// Now process deep link from email
    openTab(deepLink);
	}
}

var spotifyTabs = [];
var processedSpotifyTabs = [];

// Open new tab with Spotify deep link
function openTab(url) {
	chrome.tabs.create({url: url, active: false}, function(tab) {
		var tabId = tab.id;
    spotifyTabs.push(tab.id);
    //console.log('Newly opened tab!', tab.id);
		// Create listener to check once a tab is finished loading
    // so we can extract the URL
    chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
			if (changeInfo.status == 'complete') {
      	//console.log('Tab status changed (tab is also complete)!', tab.id);
        	chrome.tabs.get(tabId, function(tab) {
          // Check to make sure we haven't already processed this URL
          if (spotifyTabs.indexOf(tab.id) > -1 && 
            processedSpotifyTabs.indexOf(tab.id) == -1) {
                processedSpotifyTabs.push(tab.id);
                //console.log("Tab added to processedSpotifyTabs", processedSpotifyTabs);
  			        parseSpotifyEntityId(tab.url, tabId);
            }
				  });
				}
			});
	});
}

// Get entity (album, song, etc) ID from URL
function parseSpotifyEntityId(url, tabId) {
	var firstSplit = url.split("/");
	var rawEndpoint = firstSplit[4];
	var parsedEndpoint = rawEndpoint.split("?")[0];
	// Call Spotify API with album endpoint
	spotifyApi.getAlbum(parsedEndpoint)
	.then(function(data) {
		console.log('Album', data);
    getUserPlaylists(data);
    chrome.tabs.remove(tabId);
	}, function(err) {
		console.error(err);
	});
}

// Get user playlists
function getUserPlaylists(album) {
  var userId;
  // Set userId
  var user = spotifyApi.getMe(function(error, userObj) {
    if (error !== null) {
      console.log(error);
    } else {
      console.log(userObj);
      userId = userObj.id;

      // Get user playlists then check if Email Digest playlist
      // already exists
      var userPlaylists = spotifyApi.getUserPlaylists(userId, function(error, playlistObjs) {
        if (error !== null) {
          console.log("Error getting user's playlists!...", error);
        } else {
          console.log("User playlists retrieved!...", playlistObjs);
          checkForPlaylist(userId, "Email Digest", playlistObjs, album);
        }
      });
    }
  });
}

// Check if given playlist name already exists in user's playlists
function checkForPlaylist(userId, playlistName, playlistObjs, album) {
  var nameCheckReturn = playlistNameCheck(playlistName, playlistObjs);
  var nameCheckReturnBoolean = nameCheckReturn[0];
  var nameCheckReturnIndex;
  if (nameCheckReturnBoolean) {
    console.log("Playlist found! --- Adding track(s)...");
    nameCheckReturnIndex = nameCheckReturn[1];
    // If playlist exists, add to playlist object by calling addToPlaylist
    addToPlaylist(userId, playlistObjs.items[nameCheckReturnIndex], album);
  } else {
    console.log("Playlist not found! --- Creating playlist and adding track(s)...");
    // If playlist does not exist, create new playlist and add by calling createPlaylist
    createPlaylist(userId, playlistName, album);
  }
}

// Add track(s) from a given album to a given playlist for a given user
function addToPlaylist(userId, playlistObj, album) {
  // Grab the playlist ID
  var playlistId = playlistObj.id;
  // Initialize empty array in which to add track(s) from an album
  var songUris = [];
  // Add each track from the album to the songUris array
  for (var i=0; i < album.tracks.items.length; i++) {
    songUris.push(album.tracks.items[i].uri);
    // Check if songUris array is same length as number of 
    // tracks in album. If so, add tracks from songUris to
    // given playlist
    if (songUris.length === album.tracks.items.length) {
      // Add each track from the songUris array to the playlist
      spotifyApi.addTracksToPlaylist(userId, playlistId, songUris, function(error, success) {
        if (error != null) {
          console.log("Error adding tracks to playlist!...", error)
        } else {
          console.log("Successfully added "+album.tracks.items.length+" tracks to playlist!");
        }
      });
    }
  }
}

// Create a new playlist with a given name for a given user,
// and add given album tracks to the newly created playlist
function createPlaylist(userId, playlistName, album) {
  // Create new playlist, then add given album's
  // song(s) to newly created playlist
  spotifyApi.createPlaylist(userId,
    {name: playlistName, public: false},
    function(error, newPlaylistObj) {
      if (error !== null) {
        console.log("Error creating playlist!...", error);
      } else {
        console.log("Successfully created new playlist!", newPlaylistObj);
        addToPlaylist(userId, newPlaylistObj, album);
      }
  });
}

function playlistNameCheck(playlistName, playlistObjs) {
  for (var i=0; i < playlistObjs.items.length; i++) {
    if (playlistObjs.items[i]['name'].indexOf(playlistName) > -1) {
      return [true, i];
    }
  }
  return [false];
}

// Instantiate Spotify API object
var spotifyApi = new SpotifyWebApi();

// Spotify API credentials
var spotifyClientId = "f97ea406999b45bb8beeabbcffc3bacd";
var spotifyClientSecret = "982df03acdf34caeb18026bc041733f8";
var redirectUri = chrome.identity.getRedirectURL() + 'spotify';

// Check local storage for access tokens & set Spotify API object
// with them if they exist. Otherwise, authorize & retrieve
// tokens from Spotify API
function checkLocalTokens() {
  chrome.storage.local.get('tokens', function(tokenObj) {
    console.log("Local storage token object:", tokenObj);
    // Try to get user tokens from Chrome local storage, otherwise
    // authorize with Spotify API if they don't exist
    try {
      var spotifyAccessToken = tokenObj['tokens']['spotifyAccessToken'];
      var spotifyRefreshToken = tokenObj['tokens']['spotifyRefreshToken'];
      console.log("Spotify Access Token in Chrome local storage:", spotifyAccessToken);
      console.log("Spotify Refresh Token in Chrome local storage:", spotifyRefreshToken);
      if (tokenObj['tokens']['spotifyAccessToken'] !== undefined) {
        // Set Spotify API object token
        spotifyApi.setAccessToken(spotifyAccessToken);
        console.log("Spotify API object access token set to:", spotifyApi.getAccessToken());
        // Try to retrieve user object from Spotify API object
        var user = spotifyApi.getMe(function(error, userObj) {
          if (error !== null) {
            console.log("Error retrieving user object:", error);
            // Check if token expired & refresh if expired
            if (error.status == 401 &&
              error.response.indexOf("The access token expired") > -1) {
              console.log("Token expired! Refreshing token...");
              getSpotifyTokens("refresh_token", spotifyRefreshToken);
            }
          } else {
            console.log("User object retrieved successfully", userObj);
          }
        });
      } else {
        // Authorize with Spotify API
        beginSpotifyAuthProcess();
      }
    } catch (e) {
      console.log("Error in retrieving Chrome local storage access tokens:", e)
      // Authorize with Spotify API
      beginSpotifyAuthProcess();
    }
  });
}

function beginSpotifyAuthProcess() {
  // Initiate Spotify Authorization sequence
  console.log("Access token not found in Chrome local storage, authorizing with Spotify...");
  // Set authorization scopes
  var scopes = "playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private user-follow-read user-follow-modify";
  // Use Chrome's built-in auth handler
  chrome.identity.launchWebAuthFlow({
      "url": "https://accounts.spotify.com/authorize?client_id="+spotifyClientId+
             "&response_type=code"+
             "&redirect_uri="+ encodeURIComponent(redirectUri) + 
             "&scope="+
             encodeURIComponent(scopes),
      'interactive': true,  
    },
    function(rawResponse) {
      // Parse raw response with code
      console.log("Raw response:", rawResponse);
      var splitCodeResponse = rawResponse.split('=');
      var parsedCodeResponse = splitCodeResponse[1].split('&')[0];
      console.log("Parsed response code:", parsedCodeResponse);
      // Now get access & refresh tokens using parsed response code 
      getSpotifyTokens("authorization_code", parsedCodeResponse);
  });
}

// Handler to get Spotify access tokens using code or refresh token
function getSpotifyTokens(grant_type, accessCodeOrRefreshToken) {
  console.log('Fetching Spotify Access Tokens for grant_type: '+
    grant_type+' with code/token:', accessCodeOrRefreshToken);
  var data = {grant_type: grant_type,
    redirect_uri: encodeURIComponent(redirectUri),
    client_id: spotifyClientId,
    client_secret: spotifyClientSecret
  };

  if (grant_type == 'authorization_code') {
    data.code = accessCodeOrRefreshToken;
  } else if (grant_type == 'refresh_token') {
    data.refresh_token = accessCodeOrRefreshToken;
  }

  $.ajax({
    type: "POST",
    url: "https://accounts.spotify.com/api/token",
    data: data,
    error: function(jqXHR, textStatus, errorThrown) {
      console.log("Error hitting Spotify API:", jqXHR.responseText);
    },
    success: function(tokenResponse) {
      console.log("Spotify token response:", tokenResponse);
      // Retrieve Spotify access token, token duration, and
      // refresh token from token response object
      var spotifyAccessToken = tokenResponse.access_token;
      console.log("Spotify access token:", spotifyAccessToken);
      var spotifyTokenDuration = tokenResponse.expires_in;
      console.log("Spotify access token expires in:", spotifyTokenDuration+" seconds");
      var spotifyRefreshToken = tokenResponse.refresh_token;
      console.log("Spotify refresh token:", spotifyRefreshToken);
      // Create token object with new access token
      var tokenObject = {
          spotifyAccessToken: spotifyAccessToken
        };
      // If new refresh token given, update token object - not sure which
      // check is necessary - will have to see when an access token expires
      // and a new one is given, but guessing it's either undefined or null
      if (spotifyRefreshToken !== undefined || spotifyRefreshToken !== null) {
        tokenObject.spotifyRefreshToken = spotifyRefreshToken
      }
      // Set Spotify API object access token & save to local storage
      chrome.storage.local.set({
        'tokens': tokenObject
      }, function() {
        // Verify that new token(s) have been set in local storage
        chrome.storage.local.get('tokens', function(tokens) {
          console.log("Chrome local storage access tokens:", tokens);
        });
        // Update Spotify API object with new access token
        spotifyApi.setAccessToken(spotifyAccessToken);
        console.log("Spotify API object access token set to:", spotifyApi.getAccessToken());
      }); 
    }
  });
}

initializeGmailAuthSequence();

// Poll every hour for new emails to process
setTimeout(function() {
  initializeGmailAuthSequence();
}, 60000);