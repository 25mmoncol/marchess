import {Chess} from './vendor/chess.js';

const $=id=>document.getElementById(id);
const pieceNames={k:'king',q:'queen',r:'rook',b:'bishop',n:'knight',p:'pawn'};
const dragThreshold=6;
const humanColor='w';
let game=new Chess(), draft={}, tool=null, selected=null, flipped=false, playing=false, busy=false, ready=false, engineFailed=false, suggestion=null, topThreeEnabled=false, topMoves=[], worker, searchFen='', purpose='analyze', dragging=null, searchTimer=null, engineRestartAttempts=0, suppressClick=false, pendingSearch=null, showCoordinates=true;

function say(text){$('message').textContent=text;}

function loadSettings(){
  try{
    const saved=localStorage.getItem('chess-position-lab-settings');
    if(!saved)return;
    const settings=JSON.parse(saved);
    if(['classic','blue','green','walnut'].includes(settings.boardTheme))$('board-theme').value=settings.boardTheme;
    if(typeof settings.showCoordinates==='boolean')showCoordinates=settings.showCoordinates;
  }catch(error){
    console.error('Could not load saved settings.',error);
  }
}

function saveSettings(){
  try{
    localStorage.setItem('chess-position-lab-settings',JSON.stringify({
      boardTheme:$('board-theme').value,
      showCoordinates
    }));
  }catch(error){
    console.error('Could not save settings.',error);
    say('Settings could not be saved in this browser.');
  }
}

function renderPiece(element,piece){
  element.replaceChildren();
  if(!piece)return;
  const image=document.createElement('img');
  image.className='chess-piece';
  image.src=`pieces/staunty/${piece[0]}${piece[1].toUpperCase()}.svg`;
  image.alt='';
  image.draggable=false;
  image.setAttribute('aria-hidden','true');
  element.append(image);
}

function mapBoard(position=game){
  const pieces={};
  for(const row of position.board())for(const piece of row)if(piece)pieces[piece.square]=piece.color+piece.type;
  return pieces;
}

function setDraftTurn(position){
  const fen=position.fen().split(' ');
  $('side').value=fen[1];
  document.querySelectorAll('.rights input[value]').forEach(input=>{
    input.checked=input.value==='w'?/[KQ]/.test(fen[2]):/[kq]/.test(fen[2]);
  });
}

function draftPosition(){
  const position=new Chess();
  position.clear();
  for(const [square,piece] of Object.entries(draft))position.put({type:piece[1],color:piece[0]},square);
  return position;
}

function kingInCheck(color){
  const position=playing?game:draftPosition();
  const king=position.board().flat().find(piece=>piece?.color===color&&piece.type==='k');
  return Boolean(king&&position.isAttacked(king.square,color==='w'?'b':'w'));
}

function drawMoveArrows(){
  const svg=$('move-arrows');
  svg.replaceChildren();
  if(!topThreeEnabled)return;
  const svgNs='http://www.w3.org/2000/svg';
  const colors=['#37e35f','#ffe34d','#ff7043'];
  const defs=document.createElementNS(svgNs,'defs');
  colors.forEach((color,index)=>{
    const marker=document.createElementNS(svgNs,'marker');
    marker.setAttribute('id',`move-arrow-${index+1}`);
    marker.setAttribute('viewBox','0 0 12 12');
    marker.setAttribute('refX','10');
    marker.setAttribute('refY','6');
    marker.setAttribute('markerWidth','8');
    marker.setAttribute('markerHeight','8');
    marker.setAttribute('orient','auto');
    const tip=document.createElementNS(svgNs,'path');
    tip.setAttribute('d','M 1 1 L 11 6 L 1 11 z');
    tip.setAttribute('fill',color);
    tip.setAttribute('stroke','#11151b');
    tip.setAttribute('stroke-width','1');
    marker.append(tip);
    defs.append(marker);
  });
  svg.append(defs);
  topMoves.forEach((uci,index)=>{
    if(!uci||index>2)return;
    const from=uci.slice(0,2),to=uci.slice(2,4);
    if(!/^[a-h][1-8]$/.test(from)||!/^[a-h][1-8]$/.test(to))return;
    const point=square=>{
      const file=square.charCodeAt(0)-97,rank=Number(square[1]);
      return {x:(flipped?7-file:file)*100+50,y:(flipped?rank-1:8-rank)*100+50};
    };
    const start=point(from),end=point(to),color=colors[index];
    const underlay=document.createElementNS(svgNs,'line');
    underlay.setAttribute('x1',start.x);underlay.setAttribute('y1',start.y);
    underlay.setAttribute('x2',end.x);underlay.setAttribute('y2',end.y);
    underlay.setAttribute('stroke','#11151b');
    underlay.setAttribute('stroke-width','8');
    underlay.setAttribute('stroke-linecap','round');
    const arrow=document.createElementNS(svgNs,'line');
    arrow.setAttribute('x1',start.x);arrow.setAttribute('y1',start.y);
    arrow.setAttribute('x2',end.x);arrow.setAttribute('y2',end.y);
    arrow.setAttribute('stroke',color);
    arrow.setAttribute('stroke-width','4');
    arrow.setAttribute('stroke-linecap','round');
    arrow.setAttribute('marker-end',`url(#move-arrow-${index+1})`);
    svg.append(underlay,arrow);
  });
}

function clearCastlingRights(piece){
  if(piece[1]==='k')document.querySelector(`.rights input[value="${piece[0]}"]`).checked=false;
}

function removeDraftPiece(square){
  const piece=draft[square];
  if(piece)clearCastlingRights(piece);
  delete draft[square];
}

function castleRookMove(from,to,piece){
  if(piece[1]!=='k')return null;
  const rank=piece[0]==='w'?'1':'8';
  if(from!==`e${rank}`||!['c','g'].some(file=>to===`${file}${rank}`))return null;
  const kingSide=to[0]==='g';
  if(!document.querySelector(`.rights input[value="${piece[0]}"]`).checked)return null;
  const rookFrom=`${kingSide?'h':'a'}${rank}`,rookTo=`${kingSide?'f':'d'}${rank}`;
  if(draft[rookFrom]!==piece[0]+'r')return null;
  const emptyFiles=kingSide?['f','g']:['b','c','d'];
  if(emptyFiles.some(file=>draft[file+rank]))return null;
  const position=draftPosition(),opponent=piece[0]==='w'?'b':'w';
  const kingPath=kingSide?['e','f','g']:['e','d','c'];
  if(kingPath.some(file=>position.isAttacked(file+rank,opponent)))return null;
  return {from:rookFrom,to:rookTo};
}

function moveDraftPiece(from,to){
  const piece=draft[from];
  if(!piece||from===to)return;
  const castle=castleRookMove(from,to,piece),captured=draft[to];
  clearCastlingRights(piece);
  if(captured)clearCastlingRights(captured);
  delete draft[from];
  draft[to]=piece;
  if(castle){
    const rook=draft[castle.from];
    clearCastlingRights(rook);
    delete draft[castle.from];
    draft[castle.to]=rook;
  }
  updateDraft();
}

function updateEvaluation(scoreType,value,turn){
  const whiteScore=Number(value)*(turn==='w'?1:-1);
  const advantage=scoreType==='mate'
    ?whiteScore>0?99:whiteScore<0?1:50
    :100/(1+Math.pow(10,-Math.max(-1000,Math.min(1000,whiteScore))/400));
  const text=scoreType==='mate'
    ?`${whiteScore>0?'+':whiteScore<0?'-':''}M${Math.abs(whiteScore)}`
    :`${whiteScore>=0?'+':''}${(whiteScore/100).toFixed(2)}`;
  $('eval-number').textContent=text;
  $('eval-number').classList.toggle('black-advantage',whiteScore<0);
  $('eval-fill').style.height=`${advantage}%`;
  $('eval-track').setAttribute('aria-valuenow',String(Math.round(advantage)));
  $('eval-track').setAttribute('aria-valuetext',`${text} from White's perspective`);
}

function clearEvaluation(){
  $('eval-number').textContent='—';
  $('eval-number').classList.remove('black-advantage');
  $('eval-fill').style.height='50%';
  $('eval-track').setAttribute('aria-valuenow','50');
  $('eval-track').setAttribute('aria-valuetext','No evaluation');
}

function render(){
  const editing=!playing, boardPosition=editing?draft:mapBoard(), files=flipped?'hgfedcba':'abcdefgh', ranks=flipped?'12345678':'87654321';
  const targets=selected&&!editing?game.moves({square:selected,verbose:true}).map(move=>move.to):[];
  $('board').replaceChildren();
  for(const rank of ranks)for(const file of files){
    const square=file+rank,piece=boardPosition[square],button=document.createElement('button');
    const suggestedFrom=suggestion?.slice(0,2)===square,suggestedTo=suggestion?.slice(2,4)===square;
    button.className='square'+(((file.charCodeAt(0)-97+Number(rank))%2===0)?' dark':'')+(piece?.[0]==='w'?' white-piece':'')+(selected===square?' selected':'')+(targets.includes(square)?' target':'')+(suggestedFrom?' best best-from':'')+(suggestedTo?' best best-to':'');
    renderPiece(button,piece);
    button.setAttribute('aria-label',`${square}${piece?' '+(piece[0]==='w'?'white':'black')+' '+pieceNames[piece[1]]:' empty'}`);
    button.draggable=false;
    if(showCoordinates&&file===files[0]){const coordinate=document.createElement('span');coordinate.className='coord';coordinate.textContent=rank;button.append(coordinate);}
    if(showCoordinates&&rank===ranks[7]){const coordinate=document.createElement('span');coordinate.className='coord file';coordinate.textContent=file;button.append(coordinate);}
    button.onclick=()=>clickSquare(square);
    $('board').append(button);
  }
  drawMoveArrows();
  $('board-theme').value=$('board-theme').value||'blue';
  $('board-wrap').dataset.boardTheme=$('board-theme').value;
  $('coordinates-toggle').checked=showCoordinates;
  $('palette').querySelectorAll('.palette-piece').forEach(button=>renderPiece(button,button.dataset.piece));
  $('modeText').textContent=playing?'Playing Stockfish':'Freeform editor';
  $('fen').value=editing?draftFen():game.fen();
  $('editor').hidden=playing;
  $('stop').hidden=!playing;
  $('play').hidden=playing;
  $('undo').hidden=!playing;
  $('history').hidden=!playing;
  for(const [id,color] of [['analyze-white','w'],['analyze-black','b']]){
    const button=$(id),checkedColor=color==='w'?'b':'w',inCheck=kingInCheck(checkedColor);
    button.textContent=`${color==='w'?'White':'Black'} best move${inCheck?` (${checkedColor==='w'?'White':'Black'} in check)`:''}`;
    button.disabled=!ready||busy||(playing&&game.isGameOver())||inCheck;
  }
  $('apply').disabled=busy||!suggestion;
  $('top-three').checked=topThreeEnabled;
  $('top-three').disabled=busy&&purpose!=='evaluate';
  $('restart').hidden=!engineFailed;
  $('restart').disabled=busy;
  $('palette').querySelectorAll('button').forEach(button=>button.disabled=busy&&purpose!=='evaluate');
  $('side').disabled=busy;
  document.querySelectorAll('.rights input[value]').forEach(input=>input.disabled=busy);
  for(const id of ['undo','reset','load','play','stop','clear'])$(id).disabled=busy;
  $('undo').disabled=busy||!playing||game.history().length===0;
  $('history').textContent=game.history().map((move,index)=>(index%2===0?`${Math.floor(index/2)+1}. `:'')+move).join(' ');
}

function clearResult(){
  suggestion=null;
  topMoves=[];
  $('best').textContent='Find your next move';
  clearEvaluation();
  $('line').textContent='';
  $('depth').textContent='';
  drawMoveArrows();
}

function validatePosition(position){
  const pieces=position.board().flat().filter(Boolean);
  for(const color of ['w','b']){
    const sidePieces=pieces.filter(piece=>piece.color===color);
    if(sidePieces.filter(piece=>piece.type==='k').length!==1)throw Error('A position needs exactly one king of each color.');
    if(sidePieces.length>16||sidePieces.filter(piece=>piece.type==='p').length>8)throw Error('Each side can have at most 16 pieces and 8 pawns.');
  }
  const other=position.turn()==='w'?'b':'w', king=pieces.find(piece=>piece.color===other&&piece.type==='k');
  if(position.isAttacked(king.square,position.turn()))throw Error('The side that just moved cannot leave its own king in check. Change whose turn it is or move the attacking piece.');
  const [,turn,rights,ep]=position.fen().split(' '),squares={};
  for(const piece of pieces)squares[piece.square]=piece.color+piece.type;
  for(const [right,kingSquare,rookSquare] of [['K','e1','h1'],['Q','e1','a1'],['k','e8','h8'],['q','e8','a8']]){
    const color=right===right.toUpperCase()?'w':'b';
    if(rights.includes(right)&&(squares[kingSquare]!==color+'k'||squares[rookSquare]!==color+'r'))throw Error('Castling rights require the king and rook on their original squares.');
  }
  if(ep!=='-'){
    const pawn=turn==='w'?'bp':'wp',rank=turn==='w'?'5':'4';
    if(squares[ep[0]+rank]!==pawn||squares[ep])throw Error('The en passant square does not match a pawn that just moved two squares.');
  }
  return position;
}

function draftFen(){
  const rows=[];
  for(let rank=8;rank>=1;rank--){
    let row='',empty=0;
    for(const file of 'abcdefgh'){
      const piece=draft[file+rank];
      if(!piece)empty++;
      else{if(empty)row+=empty;empty=0;row+=piece[0]==='w'?piece[1].toUpperCase():piece[1];}
    }
    if(empty)row+=empty;
    rows.push(row);
  }
  let rights='';
  if(document.querySelector('.rights input[value="w"]').checked&&draft.e1==='wk'){
    if(draft.h1==='wr')rights+='K';
    if(draft.a1==='wr')rights+='Q';
  }
  if(document.querySelector('.rights input[value="b"]').checked&&draft.e8==='bk'){
    if(draft.h8==='br')rights+='k';
    if(draft.a8==='br')rights+='q';
  }
  return `${rows.join('/')} ${$('side').value} ${rights||'-'} - 0 1`;
}

function updateDraft(){
  selected=null;
  clearResult();
  render();
  search('evaluate');
}

function clickSquare(square){
  if(busy&&purpose!=='evaluate')return;
  if(!playing){
    if(tool){
      if(tool==='erase')removeDraftPiece(square);
      else{
        if(draft[square])removeDraftPiece(square);
        if(tool[1]==='k')for(const key in draft)if(draft[key]===tool)removeDraftPiece(key);
        draft[square]=tool;
      }
      updateDraft();
      return;
    }
    if(selected&&selected!==square){
      moveDraftPiece(selected,square);
      return;
    }
    selected=draft[square]? (selected===square?null:square):null;
    render();
    return;
  }
  if(game.turn()!==humanColor)return;
  if(selected&&selected!==square){
    const options=game.moves({square:selected,verbose:true}).filter(move=>move.to===square);
    if(options.length){
      let promotion='q';
      if(options.some(move=>move.promotion)){
        const answer=prompt('Promote to: q = queen, r = rook, b = bishop, n = knight','q');
        if(answer===null)return;
        promotion=answer.toLowerCase();
        if(!['q','r','b','n'].includes(promotion)){say('Choose q, r, b, or n for promotion.');return;}
      }
      game.move({from:selected,to:square,promotion});
      selected=null;
      clearResult();
      render();
      afterMove();
      return;
    }
  }
  selected=game.get(square)?.color===game.turn()?square:null;
  render();
}

function afterMove(){
  say(game.isGameOver()?'Game over.':'');
  if(!playing)return;
  if(game.isGameOver()){
    search('evaluate');
    return;
  }
  search(game.turn()===humanColor?'evaluate':'play');
}

function search(type){
  if(!ready||(playing&&game.isGameOver()&&type!=='evaluate'))return;
  if(busy){
    if(purpose==='evaluate'&&type!=='evaluate')pendingSearch=type;
    return;
  }
  let position;
  try{position=validatePosition(playing?game:new Chess(draftFen()));}
  catch(error){
    if(type==='analyze'&&topThreeEnabled){
      topMoves=[];
      drawMoveArrows();
      render();
    }
    say(`Position needs a change: ${error.message}`);
    return;
  }
  busy=true;
  purpose=type;
  searchFen=position.fen();
  if(type!=='evaluate')suggestion=null;
  if(type==='analyze'&&topThreeEnabled)topMoves=[];
  selected=null;
  if(type!=='evaluate'){
    if(type==='analyze'&&topThreeEnabled){
      $('best').textContent='Ranking top 3 moves…';
      $('line').textContent='Green · Yellow · Orange';
    }else{
      clearEvaluation();
      $('best').textContent='Thinking…';
      $('line').textContent='Stockfish is exploring legal continuations.';
    }
  }
  render();
  worker.postMessage(`setoption name MultiPV value ${type==='analyze'&&topThreeEnabled?3:1}`);
  worker.postMessage('position fen '+searchFen);
  const moveTime=type==='evaluate'?500:Number($('time').value);
  worker.postMessage('go movetime '+moveTime);
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{
    if(!busy)return;
    busy=false;
    if(engineRestartAttempts===0){
      engineRestartAttempts++;
      say('Stockfish stopped responding. Restarting the engine.');
      restartEngine();
    }else{
      ready=false;
      engineFailed=true;
      worker?.terminate();
      worker=null;
      $('engine').textContent='Stockfish unavailable';
      say('Stockfish stopped responding. Use Restart Stockfish to try again.');
      render();
    }
  },moveTime+10000);
}

function restartEngine(){
  clearTimeout(searchTimer);
  searchTimer=null;
  busy=false;
  ready=false;
  engineFailed=false;
  clearResult();
  worker?.terminate();
  worker=null;
  $('engine').textContent='Restarting Stockfish…';
  render();
  startEngine();
}

function startEngine(){
  worker=new Worker('./vendor/stockfish-19-lite-single.js');
  const timer=setTimeout(()=>{if(!ready){$('engine').textContent='Engine taking longer to load';say('Stockfish is still loading. If this persists, refresh or try a browser with WebAssembly support.');}},20000);
  worker.onerror=()=>{
    clearTimeout(timer);
    clearTimeout(searchTimer);
    searchTimer=null;
    busy=false;
    if(engineRestartAttempts===0){
      engineRestartAttempts++;
      say('Stockfish stopped responding. Restarting the engine.');
      restartEngine();
      return;
    }
    ready=false;
    worker?.terminate();
    worker=null;
    engineFailed=true;
    $('engine').textContent='Stockfish unavailable';
    say('Stockfish stopped responding. Use Restart Stockfish to try again.');
    render();
  };
  worker.onmessage=({data})=>{
    for(const line of String(data).split('\n').map(message=>message.trim())){
      if(line==='uciok'){worker.postMessage('setoption name Hash value 32');worker.postMessage('isready');}
      if(line==='readyok'){
        clearTimeout(timer);
        ready=true;
        engineFailed=false;
        $('engine').textContent='Stockfish 19 · Ready';
        render();
        if(playing&&!game.isGameOver()&&game.turn()!==humanColor)search('play');
        else if(!playing||!game.isGameOver())search('evaluate');
      }
      if(line.startsWith('info ')&&busy){
        const depth=line.match(/\bdepth (\d+)/),score=line.match(/\bscore (cp|mate) (-?\d+)/),pv=line.match(/\bpv (.+)/),multiPv=Number(line.match(/\bmultipv (\d+)/)?.[1]||1);
        if(depth&&purpose!=='evaluate')$('depth').textContent=`Depth ${depth[1]} · Evaluation from White’s side`;
        if(score&&multiPv===1){
          const turn=searchFen.split(' ')[1];
          updateEvaluation(score[1],score[2],turn);
        }
        if(pv&&purpose==='analyze'&&topThreeEnabled){
          topMoves[multiPv-1]=pv[1].trim().split(' ')[0];
          drawMoveArrows();
        }else if(pv&&purpose!=='evaluate'){
          const clone=new Chess(searchFen),moves=[];
          for(const uci of pv[1].trim().split(' ').slice(0,7))try{moves.push(clone.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]}).san);}catch{break;}
          $('line').textContent=moves.join('  ');
        }
      }
      if(line.startsWith('bestmove ')&&busy){
        clearTimeout(searchTimer);
        searchTimer=null;
        busy=false;
        engineRestartAttempts=0;
        const uci=line.split(' ')[1];
        if(purpose==='analyze'&&topThreeEnabled){
          worker.postMessage('setoption name MultiPV value 1');
        }
        if(uci==='(none)'||uci==='0000'){
          suggestion=null;
          if(purpose!=='evaluate')say('There are no legal moves in this position.');
          render();
          return;
        }
        if(purpose==='evaluate'){
          suggestion=null;
          render();
          const nextSearch=pendingSearch;
          pendingSearch=null;
          if(nextSearch)search(nextSearch);
          else if(searchFen!==(playing?game.fen():draftFen()))search('evaluate');
          return;
        }
        suggestion=uci;
        const clone=new Chess(searchFen);
        try{
          const move=clone.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
          $('best').textContent=move.san;
          if(topThreeEnabled&&purpose==='analyze'){
            const ranked=topMoves.map(candidate=>{
              try{
                const position=new Chess(searchFen),rankedMove=position.move({from:candidate.slice(0,2),to:candidate.slice(2,4),promotion:candidate[4]});
                return rankedMove.san;
              }catch{return null;}
            }).filter(Boolean);
            $('line').textContent=ranked.map((san,index)=>`${index+1}. ${san}`).join('  ');
          }
          say(`Best move: ${move.san} (${move.from} to ${move.to}).`);
          if(purpose==='play')apply();
          else render();
        }catch{
          say('The engine returned an invalid move. Try again.');
          clearResult();
          render();
        }
      }
    }
  };
  worker.postMessage('uci');
}

function apply(){
  if(!suggestion||busy)return;
  const move={from:suggestion.slice(0,2),to:suggestion.slice(2,4),promotion:suggestion[4]};
  if(playing)game.move(move);
  else{
    const position=new Chess(searchFen);
    position.move(move);
    game=position;
    draft=mapBoard(position);
    setDraftTurn(position);
  }
  clearResult();
  selected=null;
  render();
  if(playing)afterMove();
  else{
    say('');
    search('evaluate');
  }
}

function buildPalette(){
  for(const piece of 'wk wq wr wb wn wp bk bq br bb bn bp'.split(' ')){
    const button=document.createElement('button');
    button.type='button';
    renderPiece(button,piece);
    button.title=`Drag or select ${piece[0]==='w'?'white':'black'} ${pieceNames[piece[1]]}`;
    button.setAttribute('aria-label',button.title);
    button.dataset.piece=piece;
    button.draggable=false;
    button.className='palette-piece';
    button.onclick=()=>{
      selectPalettePiece(piece);
    };
    $('palette').append(button);
  }
}

function squareForLabel(label){
  return label?.slice(0,2)||'';
}

function selectPalettePiece(piece){
  tool=tool===piece?null:piece;
  selected=null;
  $('palette').querySelectorAll('.palette-piece').forEach(item=>item.classList.toggle('chosen',item.dataset.piece===tool));
  say('');
}

function moveDraggedPiece(to){
  if(!dragging||!to||busy&&purpose!=='evaluate')return;
  if(playing){
    if(dragging.kind==='board'){
      selected=dragging.from;
      clickSquare(to);
    }
    dragging=null;
    return;
  }

  if(dragging.kind==='board'&&dragging.from===to)return;
  const castle=dragging.kind==='board'?castleRookMove(dragging.from,to,dragging.piece):null;
  if(dragging.kind==='board')removeDraftPiece(dragging.from);
  if(draft[to])removeDraftPiece(to);
  if(dragging.piece[1]==='k')for(const key in draft)if(draft[key]===dragging.piece)removeDraftPiece(key);
  draft[to]=dragging.piece;
  if(castle){
    const rook=draft[castle.from];
    clearCastlingRights(rook);
    delete draft[castle.from];
    draft[castle.to]=rook;
  }
  tool=null;
  $('palette').querySelectorAll('.palette-piece').forEach(button=>button.classList.remove('chosen'));
  updateDraft();
  say('');
}

function boardSquareAtPoint(x,y){
  return [...$('board').querySelectorAll('.square')].find(square=>{
    const rect=square.getBoundingClientRect();
    return x>=rect.left&&x<rect.right&&y>=rect.top&&y<rect.bottom;
  })||null;
}

function clearPointerDrag(){
  document.querySelectorAll('.square.dragging,.square.drop-target').forEach(square=>square.classList.remove('dragging','drop-target'));
  document.querySelector('.drag-preview')?.remove();
  dragging=null;
}

function suppressGeneratedClick(){
  suppressClick=true;
  setTimeout(()=>{suppressClick=false;},0);
}

function beginPointerDrag(event){
  if(event.button!==0||busy&&purpose!=='evaluate'||dragging)return;
  const square=event.target.closest('.square');
  const palettePiece=event.target.closest('.palette-piece');
  if(!square&&!palettePiece||playing&&palettePiece)return;
  let kind,piece,from;
  if(square){
    from=squareForLabel(square.getAttribute('aria-label'));
    const current=playing?game.get(from):null;
    piece=playing?(current?current.color+current.type:null):draft[from];
    if(!piece||playing&&piece[0]!==game.turn())return;
    kind='board';
  }else{
    piece=palettePiece.dataset.piece;
    kind='palette';
  }
  event.preventDefault();
  dragging={kind,piece,from,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,moved:false};
}

function updatePointerDrag(event){
  if(!dragging||event.pointerId!==dragging.pointerId)return;
  const distance=Math.hypot(event.clientX-dragging.startX,event.clientY-dragging.startY);
  if(!dragging.moved&&distance<dragThreshold)return;
  if(!dragging.moved){
    dragging.moved=true;
    document.querySelector(`.square[aria-label^="${dragging.from}"]`)?.classList.add('dragging');
    const preview=document.createElement('span');
    preview.className='drag-preview';
    renderPiece(preview,dragging.piece);
    preview.style.color=dragging.piece[0]==='w'?'#fff':'#17232c';
    document.body.append(preview);
  }
  const preview=document.querySelector('.drag-preview');
  if(preview){
    preview.style.left=`${event.clientX-24}px`;
    preview.style.top=`${event.clientY-24}px`;
  }
  document.querySelectorAll('.square.drop-target').forEach(square=>square.classList.remove('drop-target'));
  boardSquareAtPoint(event.clientX,event.clientY)?.classList.add('drop-target');
}

function finishPointerDrag(event){
  if(!dragging||event.pointerId!==dragging.pointerId)return;
  const current=dragging;
  suppressGeneratedClick();
  if(current.moved){
    const target=boardSquareAtPoint(event.clientX,event.clientY);
    if(target)moveDraggedPiece(squareForLabel(target.getAttribute('aria-label')));
    else if(current.kind==='board'&&!playing){
      removeDraftPiece(current.from);
      updateDraft();
      say('');
    }
    clearPointerDrag();
    return;
  }
  clearPointerDrag();
  if(current.kind==='board')clickSquare(current.from);
  else selectPalettePiece(current.piece);
}

document.addEventListener('pointerdown',event=>{
  if(event.target.closest('#board,.palette'))beginPointerDrag(event);
});
document.addEventListener('pointermove',updatePointerDrag);
document.addEventListener('pointerup',finishPointerDrag);
document.addEventListener('pointercancel',clearPointerDrag);
document.addEventListener('click',event=>{
  if(!suppressClick)return;
  event.preventDefault();
  event.stopImmediatePropagation();
},true);
$('analyze-white').onclick=()=>{$('side').value='w';search('analyze');};
$('analyze-black').onclick=()=>{$('side').value='b';search('analyze');};
$('apply').onclick=apply;
$('top-three').onchange=()=>{
  topThreeEnabled=$('top-three').checked;
  topMoves=[];
  drawMoveArrows();
  render();
};
$('board-theme').onchange=()=>{
  saveSettings();
  render();
};
$('coordinates-toggle').onchange=()=>{
  showCoordinates=$('coordinates-toggle').checked;
  saveSettings();
  render();
};
$('restart').onclick=()=>{
  engineRestartAttempts=0;
  restartEngine();
};
$('flip').onclick=()=>{flipped=!flipped;render();};
$('reset').onclick=()=>{
  game=new Chess();
  draft=mapBoard(game);
  setDraftTurn(game);
  playing=false;
  selected=null;
  tool=null;
  $('palette').querySelectorAll('.palette-piece').forEach(button=>button.classList.remove('chosen'));
  clearResult();
  render();
  say('');
  search('evaluate');
};
$('undo').onclick=()=>{
  if(!playing)return;
  game.undo();
  if(playing&&game.turn()!==humanColor)game.undo();
  selected=null;
  clearResult();
  render();
  say('');
  search('evaluate');
};
$('clear').onclick=()=>{
  draft=Object.fromEntries(Object.entries(draft).filter(([,piece])=>piece[1]==='k'));
  document.querySelectorAll('.rights input[value]').forEach(input=>input.checked=false);
  selected=null;
  clearResult();
  render();
  search('evaluate');
};
$('side').onchange=updateDraft;
document.querySelectorAll('.rights input[value]').forEach(input=>input.onchange=updateDraft);
$('load').onclick=()=>{
  try{
    const position=validatePosition(new Chess($('fen').value.trim()));
    game=position;
    draft=mapBoard(position);
    setDraftTurn(position);
    playing=false;
    selected=null;
    clearResult();
    render();
    say('Position loaded and ready to edit.');
    search('evaluate');
  }catch(error){say('Could not load position: '+error.message);}
};
$('copy').onclick=async()=>{
  try{await navigator.clipboard.writeText($('fen').value);say('FEN copied.');}
  catch{$('fen').select();say('Copy the selected FEN.');}
};
$('play').onclick=()=>{
  if(!ready){say('Wait for Stockfish to finish loading.');return;}
  try{game=validatePosition(new Chess(draftFen()));}
  catch(error){say(`Position needs a change before starting a game: ${error.message}`);return;}
  playing=true;
  selected=null;
  clearResult();
  render();
  afterMove();
};
$('stop').onclick=()=>{
  playing=false;
  draft=mapBoard(game);
  setDraftTurn(game);
  selected=null;
  clearResult();
  render();
  say('');
  search('evaluate');
};
loadSettings();
buildPalette();
draft=mapBoard(game);
setDraftTurn(game);
render();
startEngine();
