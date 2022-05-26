const bucket = new WeakMap();

const data = { foo: 1 };

// push、splice等隐式修改数组长度的方法
// 直接调用会导致栈溢出，原因在于这些方法会先读取length，再设置length，导致会在第二个副作用函数执行时调用第一个副作用函数，如此反复导致溢出

let shouldTrack = true;
["push", "pop", "shift", "unshift", "splice"].forEach((method) => {
  const originMethod = Array.prototype[method];
  arrayInstrumentations[method] = function (...args) {
    shouldTrack = false;
    let res = originMethod.apply(this, args);
    shouldTrack = true;
    return res;
  };
});
[
  // include等方法实现响应式
  "includes",
  "indexOf",
  "lastIndexOf",
].forEach((method) => {
  const originMethod = Array.prototype[method];
  arrayInstrumentations[method] = function (...args) {
    let res = originMethod.apply(this, args);
    if (res === false) {
      res = originMethod.apply(this.raw, args);
    }

    return res;
  };
});
function createReactive(obj, isShallow = false, isReadonly = false) {
  return new Proxy(data, {
    get(target, key, receiver) {
      // 没有activeEffect，直接返回
      if (key === "raw") {
        return target;
      }
      if (Array.isArray(target) && arrayInstrumentations.hasOwnProperty(key)) {
        return Reflect.get(arrayInstrumentations, key, receiver);
      }
      // 只读的代表不可能发生修改，所以不需要为其创建响应式
      if (!isReadonly && typeof key !== "symbol") {
        track(target, key);
      }
      if (isShallow) {
        return res;
      }
      // 使用Reflect还能接受第三个参数，即指定接收者receiver，把它理解成函数调用过程中的this
      // 防止this指向原始对象而不是代理对象，导致响应式不能触发
      const res = Reflect.get(target, key, receiver);
      // 深响应实现需要在Reflect返回结果做一层包装
      // 检测类型如果是对象，则再包装reactive一层
      if (typeof res === "object" && res !== null) {
        return isReadonly ? readonly(res) : reactive(res);
      }
      return res;
    },
    set(target, key, newVal, receiver) {
      if (isReadonly) {
        console.warn(`属性${key}是只读的`);
        return true;
      }
      const oldVal = target[key];
      const type = Array.isArray(target)
        ? Number(key) < target.length
          ? "SET"
          : "ADD"
        : Object.prototype.hasOwnProperty.call(target, key)
        ? "SET"
        : "ADD";
      const res = Reflect.set(target, key, newVal, receiver);
      if (target === receiver.raw) {
        if (oldVal !== newVal && (oldVal === oldVal || newVal === newVal)) {
          trigger(target, key, type, newVal);
        }
      }

      return res;
    },
    deleteProperty(target, key) {
      if (isReadonly) {
        console.warn(`属性${key}是只读的`);
        return true;
      }
      const hadKey = Object.prototype.hasOwnProperty.call(target, key);
      const res = Reflect.deleteProperty(target, key);
      if (res && hadKey) {
        trigger(target, key, "DELETE");
      }
      return res;
    },
    has(target, key) {
      track(target, key);
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      track(target, Array.isArray(target) ? "length" : ITERATE_KEY);
      return Reflect.ownKeys(target);
    },
  });
}
// const obj = new Proxy(data, {
//   get(target, key, receiver) {
//     // 没有activeEffect，直接返回
//     track(target, key);
//     return Reflect.get(target, key, receiver);
//   },
//   set(target, key, newVal) {
//     const oldVal = target[key]
//     const type = Object.prototype.hasOwnProperty.call(target, key)
//       ? "SET"
//       : "ADD";
//     const res = Reflect.set(target, key, newVal, receiver);
//     if (oldVal !== newVal && (oldVal === oldVal || newVal === newVal)) {
//       trigger(target, key, type);
//     }

//     return res;
//   },
//   deleteProperty(target, key) {
//     const hadKey = Object.prototype.hasOwnProperty.call(target, key);
//     const res = Reflect.deleteProperty(target, key);
//     if (res && hadKey) {
//       trigger(target, key, "DELETE");
//     }
//     return res;
//   },
//   has(target, key) {
//     track(target, key);
//     return Reflect.has(target, key);
//   },
//   ownKeys(target) {
//     track(target, ITERATE_KEY);
//     return Reflect.ownKeys(target);
//   },
// });

function track(target, key) {
  if (!activeEffect || !shouldTrack) return;
  // 根据target从‘桶’中取得所有的depsMap，他也是一个Map类型：key -》effects
  let depsMap = bucket.get(target);
  if (!depsMap) {
    bucket.set(target, (depsMap = new Map()));
  }
  // 再根据key从depsMap中取得deps，它是一个Set类型，里面存着所有effect
  let deps = depsMap.get(key);
  if (!deps) {
    depsMap.set(key, (deps = new Set()));
  }
  deps.add(activeEffect);
  activeEffect.deps.push(deps);
}

function trigger(target, key, type, newVal) {
  const depsMap = bucket.get(target);
  if (!depsMap) return;
  const effects = depsMap.get(key);

  const effectsToRun = new Set();
  effects &&
    effects.forEach((effectFn) => {
      if (effectFn != activeEffect) {
        effectsToRun.add(effectFn);
      }
    });
  if (type === "ADD" || type === "DELETE") {
    const iterateEffects = depsMap.get(ITERATE_KEY);
    iterateEffects &&
      iterateEffects.forEach((effectFn) => {
        if (effectFn != activeEffect) {
          effectsToRun.add(effectFn);
        }
      });
  }

  if (type === "ADD" && Array.isArray(target)) {
    const lengthEffects = depsMap.get(length);
    lengthEffects &&
      lengthEffects.forEach((effectFn) => {
        if (effectFn !== activeEffect) {
          effectsToRun.add(effectFn);
        }
      });
  }

  if (Array.isArray(target) && key === "length") {
    depsMap.forEach((effects, key) => {
      if (key >= newVal) {
        effects.forEach((effectFn) => {
          if (effectFn !== activeEffect) {
            effectsToRun.add(effectFn);
          }
        });
      }
    });
  }
  effectsToRun.forEach((effectFn) => {
    if (effectFn.options.scheduler) {
      effectFn.options.scheduler(effectFn);
    } else {
      effectFn();
    }
  });
  // effects && bucket.forEach((fn) => fn());
}

let activeEffect;
// 设置一个副作用函数栈，在副作用函数执行的时候将函数压入栈中，待副作用函数执行完毕之后弹出
const effectStack = [];
function effect(fn, options = {}) {
  const effectFn = () => {
    cleanup(effectFn);
    activeEffect = effectFn;
    effectStack.push(effectFn);
    const res = fn();
    fn();
    effectStack.pop();
    activeEffect = effectStack[effectStack.length - 1];
    return res;
  };
  effectFn.options = options;
  effectFn.deps = [];
  if (!options.lazy) {
    effectFn();
  }
  return effectFn;
}
function cleanup(effectFn) {
  for (let i = 0; i < effectFn.deps.length; i++) {
    const deps = effectFn.deps[i];
    deps.delete(effectFn);
  }
  effectFn.deps.length = 0;
}

const reactiveMap = new Map();
function reactive(obj) {
  const existionProxy = reactiveMap.get(obj);
  if (existionProxy) return existionProxy;
  const proxy = createReactive(obj);
  reactiveMap.set(obj, proxy);
  return proxy;
}

function shallowReactive(obj) {
  return createReactive(obj, true);
}

function readonly(obj) {
  return createReactive(obj, false, true);
}

function shallowReadonly(obj) {
  return createReactive(obj, true, true);
}

// test
effect(() => {
  console.log(obj.foo);
  document.body.innerText = obj.text;
});

function computed(getter) {
  let value;
  let dirty = true;
  const effectFn = effect(getter, {
    lazy: true,
    scheduler() {
      dirty = true;
      trigger(obj, "value");
    },
  });

  const obj = {
    get value() {
      if (dirty) {
        value = effectFn();
        dirty = false;
      }
      track(obj, "value");
      return value;
    },
  };
  return obj;
}

// watch的实现
function watch(source, cb, options = {}) {
  let getter;
  if (typeof source === "function") {
    getter = source;
  } else {
    getter = () => traverse(source);
  }

  let oldValue, newValue;

  let cleanup;
  function onInvalidate(fn) {
    cleanup = fn;
  }
  const job = () => {
    newValue = effectFn();
    if (cleanup) {
      cleanup();
    }
    cb(newValue, oldValue, onInvalidate);
    oldValue = newValue;
  };
  effect(() => getter(), {
    lazy: true,
    scheduler: () => {
      if (options.flush === "post") {
        const p = Promise.resolve();
        p.then(job);
      } else {
        job();
      }
    },
  });
  if (options.immediate) {
    job();
  } else {
    oldValue = effectFn();
  }
}

function traverse(value, seen = new Set()) {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const k in value) {
    traverse(value[k], seen);
  }
  return value;
}

// obj.foo++;
// console.log("end");
// const sumRes = computed(() => obj.foo + obj.bar);
// console.log(sumRes.value);
watch(obj, () => {
  console.log("change");
});
obj.foo++;
