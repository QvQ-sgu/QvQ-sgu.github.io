
/* ===== safe-dom.js ===== 拆页后缺失节点返回哑元素，避免报错 */
(function () {
  var stubProto = {
    textContent:"", innerHTML:"", value:"", disabled:false, checked:false,
    className:"", href:"", download:"", type:"",
    style:{ setProperty:function(){}, removeProperty:function(){} },
    dataset:{}, children:[], classList:{
      add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){return false;}
    },
    addEventListener:function(){}, removeEventListener:function(){},
    setAttribute:function(){}, getAttribute:function(){return null;},
    querySelector:function(){return null;}, querySelectorAll:function(){return [];},
    appendChild:function(){}, removeChild:function(){}, focus:function(){}, blur:function(){},
    click:function(){}, closest:function(){return null;}, scrollIntoView:function(){},
    getBoundingClientRect:function(){return {left:0,top:0,right:0,bottom:0,width:0,height:0};},
    insertAdjacentHTML:function(){}, remove:function(){}
  };
  window.__safeEl = function () { return Object.create(stubProto); };
})();
