var express = require('express'),
    app = express.createServer(),
    redis = require('redis-node'),
    db = redis.createClient(),
    FacebookClient = require("facebook-client").FacebookClient,
    fb = new FacebookClient('key', 'secret'),
    exec  = require('child_process').exec,
    gm = require('gm');

app.use(express.staticProvider(__dirname + '/static'));
app.use(express.cookieDecoder());
app.use(express.bodyDecoder());
app.use(express.logger());
app.use(express.session({ secret: 'bananas' }));
app.use(app.router);
app.set('view engine', 'ejs');

String.prototype.wrap = function(m, b, c){
	var i, j, l, s, r;
	if(m < 1)
		return this;
	for(i = -1, l = (r = this.split("\n")).length; ++i < l; r[i] += s)
		for(s = r[i], r[i] = ""; s.length > m; r[i] += s.slice(0, j) + ((s = s.slice(j)).length ? b : ""))
			j = c == 2 || (j = s.slice(0, m + 1).match(/\S*(\s)?$/))[1] ? m : j.input.length - j[0].length
			|| c == 1 && m || j.input.length + (j = s.slice(m).match(/^\S*/)).input.length;
	return r.join("\n");
};

function restrict(req, res, next){
	fb.getSessionByRequestHeaders(req.headers)(function(fbSession){
		if (!fbSession) res.redirect('/');
		req.fb = fbSession;
		if (!req.session.user) {
			fbSession.graphCall('/me', {})(function(data){
				req.session.user = data;
			});
		}
		next();
	});
}

app.get('/', function(req, res){
	fb.getSessionByRequestHeaders(req.headers)(function(fbSession){
		if (!fbSession) {
			res.render('home', { locals: {
				messages: req.flash() || null,
				user: null,
				member: null
			}});
		} else {
			res.redirect('/create');
		}
	});
});

app.get('/create', restrict, function(req, res){
	req.fb.graphCall('/me/friends', {})(function(friends){
		req.fb.graphCall('/me/albums', {})(function(albums){
			res.render('create', { locals: {
				messages: req.flash() || null,
				user: req.session.user,
				friends: friends.data
			}});	
		});		
	});		
});

app.get('/friend/:id', restrict, function(req, res){
	req.fb.graphCall('/' + req.params.id, {})(function(friend){
		db.smembers('from:' + req.params.id, function(err, from){
			db.smembers('to:' + req.params.id, function(err, to){
				console.log(friend);
				req.fb.graphCall('/' + req.params.id + '/albums', {})(function(albums){
					res.render('friend', { locals: {
						messages: req.flash() || null,
						user: req.session.user,
						friend: friend,
						albums: albums.data,
						from: from,
						to: to
					}});	
				});		
			});		
		});		
	});		
});

app.get('/album/:id', restrict, function(req, res){
	req.fb.graphCall('/' + req.params.id, {})(function(album){
		console.log(album);
		req.fb.graphCall('/' + req.params.id + '/photos', {})(function(photos){
			res.render('album', { locals: {
				messages: req.flash() || null,
				user: req.session.user,
				album: album,
				photos: photos.data
			}});	
		});		
	});		

});

app.get('/photo/:id', restrict, function(req, res){
	req.fb.graphCall('/' + req.params.id, {})(function(photo){
		db.smembers('photo:' + req.params.id, function(err, memes){
			console.log(photo);
			res.render('photo', { locals: {
				messages: req.flash() || null,
				user: req.session.user,
				photo: photo,
				memes: memes
			}});
		});		
	});		
});

app.post('/save', restrict, function(req, res){
	req.fb.graphCall('/' + req.body.id, {})(function(photo){
		console.log(photo);
		console.log(req.body);
		var split = photo.source.split('/');
		var filename = split.pop();
		var fontSize = 60 * (photo.width / 720);
		var line1 = req.body.line1.wrap(photo.width / fontSize + 4, '\n', true);
		var line2 = req.body.line2.wrap(photo.width / fontSize + 4, '\n', true);
		exec('wget --directory-prefix=static/images/originals ' + photo.source, function(reply){
			db.incr('memes', function(err, id){
				db.hmset('meme:' + id, { fromId: req.session.user.id, fromName: req.session.user.name, toId: photo.from.id,
					toName: photo.from.name, source: photo.id, top: line1, bottom: line2, views: 0 });
				gm('static/images/originals/' + filename)
					.quality(100)
					.stroke('#000000', 3)
					.font("static/Arial.ttf", fontSize)
					.fill('#ffffff')
					.drawText(0, (line1.split('\n').length * fontSize) - photo.height/2 - fontSize/3, line1.split("'").join('').toUpperCase(), 'center')
					.drawText(0, photo.height/2 - (line2.split('\n').length * fontSize) + fontSize/3, line2.split("'").join('').toUpperCase(), 'center')
					.write("static/images/" + id + ".jpg", function(err){
						if (err) { console.log(err); res.redirect('/oops'); } else {
				  			console.log('meme ' + id + ' created');
							req.session.new = true;
							db.sadd('photo:' + photo.id, id);
							db.sadd('from:' + req.session.user.id, id);
							db.sadd('to:' + photo.from.id, id);
							req.flash('info', photo.from.name + ' has been memified');
							res.redirect('/meme/' + id);
						}
					});
			});
		});
	});	
});

app.get('/meme/:id', function(req, res){
	db.hgetall('meme:' + req.params.id, function(err, meme){
		db.smembers('from:' + meme.fromId, function(err, from){
			db.smembers('to:' + meme.toId, function(err, to){
				console.log(meme);
				db.hincrby('meme:' + req.params.id, 'views', 1);
				var share = false;
				if (req.session) {
					if (req.session.new) {
						var share = true;
						delete req.session.new;
					}
				}
				res.render('meme', { locals: {
					messages: req.flash() || null,
					user: req.session.user || null,
					id: req.params.id,
					meme: meme,
					from: from,
					to: to,
					share: share
				}});	
			});
		});
	});
});

app.get('/browse', restrict, function(req, res){
	req.fb.graphCall('/me/friends', {})(function(friends){
		var friendMemes = [];
		for (var i in friends.data) {
			db.smembers('from:' + friends.data[i].id, function(err, friendSet){
				if (friendSet.length > 0) {
					friendSet.forEach(function(meme){
						friendMemes.push(meme);
					});
				}
			});
		}		
		db.smembers('from:' + req.session.user.id, function(err, from){
			db.smembers('to:' + req.session.user.id, function(err, to){
				res.render('browse', { locals: {
					messages: req.flash() || null,
					user: req.session.user || null,
					from: from,
					to: to,
					friends: friendMemes
				}});	
			});
		});
	});
});

app.post('/allow', function(req, res){
	db.incr('allowed', function(err, reply){
		res.send('ok');
	});
});

app.post('/deny', function(req, res){
	db.incr('denied', function(err, reply){
		res.send('ok');
	});
});

app.get('/oops', function(req, res){
	db.incr('oops', function(err, reply){
		res.render('oops', { locals: {
			messages: req.flash() || null,
			user: req.session.user || null
		}});	
	});
});

app.listen(3000);
