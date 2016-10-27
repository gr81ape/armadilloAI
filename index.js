// this is necessary to import values that may change over time
const config = require('./config')

// 3rd party modules necessary to connect to the Qritter Wars Server
const io = require('socket.io-client')
const request = require('request')

console.log("Welcome to the Qritter Wars Client")

// we want to keep track of our player ID, which will be handed to us upon successful signon
let playerId
let dmgInflicted
let dmgReceived
let playerHealth = 100;
let enemyHealth = 100;
let round = 0;

// These arguments are passed to the Qritter Wars Socket Server for authentication
const socketArguments = `apiId=${config.apiId}&apiSecret=${config.apiSecret}`

// This is the api key passed to the Qritter Wars REST API in the Authorization header
// for authentication
// format: base64 encoded value of <apiId>:<apiSecret>
const apiKey = new Buffer(`${config.apiId}:${config.apiSecret}`).toString('base64')

var killProbability = function (health) {
  let enemyKillProbability
  if (health <= 30){
    // Enemy kill probability is all of critical hit probs + some regular hits
    enemyKillProbability = (0.1+(0.8*(health/30)))
  }
  else if (health <= 50){
    // Enemy kill probability is some critical hit probs
    enemyKillProbability = (0.1*(health-30/20))
  }
  else {
    enemyKillProbability = 0;
  }
  return enemyKillProbability
}

var loseProbability = function(dmgInflicted, dmgReceived){
  if (dmgInflicted - dmgReceived < (-50)){   // their lead is greater than 50
    return 1;
  }
  else if ( (-30) > dmgInflicted - dmgReceived){  // their lead is in between 30-50
    let lead = abs(dmgInflicted - dmgReceived)
    let placeholder = 50 - lead
    return (0.1 * (placeholder * 0.05))
  }
  else if (0 > dmgInflicted - dmgReceived){ // their lead is in between 0-30
    let lead = abs(dmgInflicted - dmgReceived)
    let placeholder = 30 - lead
    return (0.1 + (placeholder * 0.33))
  }
  else if (dmgInflicted - dmgReceived == 0){ // there is no lead
    return 0.5
  }
  else if(dmgInflicted - dmgReceived > 50){ // we have a lead of greater than 50
    return 0;
  }
  else if( 30 < dmgInflicted - dmgReceived){ // we have a lead between 30 and 50
    let lead = dmgInflicted - dmgReceived
    let placeholder = 50 - lead
    return 1 - ((0.1 * (placeholder * 0.05)))
  }
  else if(0 < dmgInflicted - dmgReceived){ // we have a lead between 0-30
      let lead = dmgInflicted - dmgReceieved
      let placeholder = 30 - lead
      return 1 - ((0.1 + (placeholder * 0.33)))
  }
  else{
    return 0.5;
  }
}

// here we connect to the socket, passing the apiId and apiSecret
const socket = io.connect(`http://${config.host}:${config.socketPort}`, {query: socketArguments})
console.log('connecting')

socket.on('connect', (data) => {
  // we have successfully connected to the Qritter Wars Socket Server
  console.log('connected')
})

socket.on('success', (player) => {
  // we have successfully authenticated to the Qritter Wars Socket Server
  playerId = player.id
  playerObj = player
  console.log('logged in')
})

socket.on('start game', (game) => {
  // our Qritter has started battling against another Qritter
  console.log('game started')
  dmgInflicted = 0
  dmgReceived = 0
  playerHealth = 100
  enemyHealth = 100
  round = 0
  // we want to retrieve the game information
  getGame(game.id)
      .then((game) => {
        // we check game.current to see if it is our turn to play.
        // if so, we perform move
        if (game.current === playerId) {
          performMove()
        }
      })
})

socket.on('in game', (game) => {
  // we were placed into a game prior to being connected to the socket server,
  // this usually occurs when reconnecting to the socket after being
  // disconnected
  console.log('already in game')

  getGame(game.id)
      .then((game) => {
        if (game.current === playerId) {
          console.log('your turn')
          // we check game.current to see if it is our turn to play.
          // if so, we perform move
          performMove()
        }
      })
})

socket.on('move played', (move) => {
  // someone has played a move in our game
  // if the move just played wasn't by us, it is now
  // our turn to play.
  round++;
  if (move.player != playerId) {
    if(move.action == "heal"){
      console.log(`Opponent healed!`);
      enemyHealth += move.value;
      performMove()

    }
    else{
      console.log(`Opponent landed a hit!`);
      dmgReceived += move.value;
      playerHealth -= move.value;
      performMove()
    }
  }
  else{
    if (move.action == "heal"){
      console.log(`Our qritter healed!`);
      playerHealth += move.value;
    }
    else{
      console.log(`Our qritter landed a hit!`);
      dmgInflicted += move.value;
    }
  }
})

socket.on('invalid', (error) => {
  // an error message is being sent from the socket server
  // meaning we have done something wrong
  console.log("Invalid Action", error)
})

socket.on('game over', (game) => {
  // the game we were involved in is finished. We can print
  // out the statistics for the game to analyze our strategy
  console.log("Game Over")
  getGameStats(game.game.id)
})

let getGame = (gameId) => {
  return new Promise((resolve, reject) => {

    // we want to perform a GET request to the games/:id API
    // to retrieve information about the given game
    let options = createOptions(`games/${gameId}`, "GET")

    request.get(options, (error, res, body) => {
      if (error || res.statusCode !== 200) {
        console.error("Error Getting Game", error || res.body)
        reject(error)
      } else {
        resolve(JSON.parse(body))
      }
    })
  })
}

let performMove = () => {

  // this is where we would put our logic for deciding which move to make
  // here we are just attacking all the time. We should probably be more
  // creative than this. If we don't heal our Qritter will most likely be
  // defeated in no time.

  /*
    Factors:
      Probability of killing the enemy
      - Probability of us being killed
      - Probability of losing by less damage inflicted
      + How close we are to the end of the game
      * How likely we are to lose the game as of the present round
  */
  let probability = (killProbability(enemyHealth) - killProbability(playerHealth)) +
      (((round/60)) * loseProbability(dmgInflicted, dmgReceived));
  let body
  if (probability >= 0){
    body = {action: "attack"}
  }
  else{
    body = {action: "heal"}
  }
  let options = createOptions("moves", "POST", body)

  request.post(options, (error, res, body) => {
    if (error || res.statusCode !== 200) {
      console.log("Error Performing Move", error || res.body)
    } else {
      if(body[action]="attack"){
        console.log(`attack performed successfully`)
      }
      else{
        console.log(`heal performed successfully`)
      }
    }
  })

}

let createOptions = (endpoint, method, body) => {
  // we need to return all options that the request module expects
  // for an http request. 'uri' is the location of the request, 'method'
  // is what http method we want to use (most likely GET or POST). headers
  // are the http headers we want attached to our request
  let options = {
    uri: `http://${config.host}:${config.apiPort}/${endpoint}`,
    method: method.toUpperCase(),
    headers: {
      "Authorization": `Basic ${apiKey}`,
      "Content-Type": "application/json"
    }
  }

  if (body != null) {
    // if a body has been specified we want to add it to the http request
    options.body = JSON.stringify(body)
  }

  return options
}

// the last three functions here are used to print out the statistics of the
// given game.

let getGameMoves = (gameId) => {
  // this function retrieves all moves for the given game
  return new Promise((resolve, reject) => {
    let options = createOptions(`games/${gameId}/moves`, "GET")

    request.get(options, (error, res, body) => {
      if (error || res.statusCode !== 200) {
        console.error("Error Getting Game Moves", error || res.body)
        reject(error)
      } else {
        resolve(JSON.parse(body))
      }
    })
  })
}

let getGameStats = (gameId) => {
  // this function gets the given game, all moves for the given game and
  // outputs everything we're looking for
  getGame(gameId)
      .then((game) => {
        if (game.winner === playerId) {
          console.log("You Won!!!")
        } else {
          console.log("You Lost :(")
        }
        return getGameMoves(gameId)
      })
      .then((moves) => {
        console.log("Total Moves:", moves.length)
        console.log("Me")
        console.log("==")
        printStatistics(moves.filter((move) => move.player === playerId))

        console.log("Opponent")
        console.log("========")
        printStatistics(moves.filter((move) => move.player !== playerId))
      })
      .catch((error) => {
        console.log("ISSUE", error)
      })
}

let printStatistics = (moves) => {
  // this method outputs all the attack/heal statistics for the given list
  // of moves

  // filter returns a new array consisting of all items in the array that match the
  // given criteria

  // map takes the given array (in this case moves) and returns a new array based
  // on the return values of the provided function. In this line we are transforming
  // the moves array into an array of objects containing only moves that were an attack,
  // each containing a value and result
  let attacks = moves.filter((move) => move.action === "attack").map((move) => {
    return {value: move.value, result: move.result}
  })

  // reduce passes a value from one item in the given array to the next. in this
  // line reduce will start with 0 and add attack.value from each attack to the total
  let attackValue = attacks.reduce((total, attack) => total + attack.value, 0)
  let heals = moves.filter((move) => move.action === "heal").map((move) => move.value)
  let healValue = heals.reduce((total, value) => total + value, 0)
  console.log("Attacks:", attacks.length)
  console.log("Total Attack Value:", attackValue)
  console.log("Total Attack Avg:", parseInt(attackValue / attacks.length))
  console.log("Total Hits", attacks.filter((move) => move.result === "hit").length)
  console.log("Total Critical Hits", attacks.filter((move) => move.result === "critical").length)
  console.log("Total Misses", attacks.filter((move) => move.result === "miss").length)
  console.log("Heals:", heals.length)
  console.log("Total Heal Value:", healValue)
  console.log("Total Heal Avg:", parseInt(healValue / heals.length))
}
