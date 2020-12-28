var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function prevent_default(fn) {
        return function (event) {
            event.preventDefault();
            // @ts-ignore
            return fn.call(this, event);
        };
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function to_number(value) {
        return value === '' ? null : +value;
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }

    const globals = (typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : global);
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.29.7' }, detail)));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.wholeText === data)
            return;
        dispatch_dev('SvelteDOMSetData', { node: text, data });
        text.data = data;
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    /* App.svelte generated by Svelte v3.29.7 */

    const { console: console_1 } = globals;
    const file = "App.svelte";

    function create_fragment(ctx) {
    	let main;
    	let h1;
    	let t1;
    	let div0;
    	let t2;
    	let t3_value = /*pojasevi*/ ctx[10][/*pojas*/ ctx[8]].ime + "";
    	let t3;
    	let t4;
    	let t5;
    	let br0;
    	let t6;
    	let div3;
    	let div1;
    	let t8;
    	let br1;
    	let t9;
    	let div2;
    	let t10;
    	let t11;
    	let t12;
    	let t13;
    	let br2;
    	let t14;
    	let div4;
    	let t16;
    	let input;
    	let t17;
    	let br3;
    	let t18;
    	let br4;
    	let t19;
    	let button;
    	let t21;
    	let br5;
    	let t22;
    	let div5;
    	let t23;
    	let t24;
    	let t25;
    	let t26_value = /*pojasevi*/ ctx[10][/*pojas*/ ctx[8] + 1].ime + "";
    	let t26;
    	let t27;
    	let t28;
    	let br6;
    	let t29;
    	let div6;
    	let t30;
    	let t31;
    	let t32;
    	let div7;
    	let t33;
    	let t34;
    	let t35;
    	let div8;
    	let t36;
    	let t37;
    	let t38;
    	let div9;
    	let t39;
    	let t40;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			main = element("main");
    			h1 = element("h1");
    			h1.textContent = "Tablica množenja";
    			t1 = space();
    			div0 = element("div");
    			t2 = text("Imate ");
    			t3 = text(t3_value);
    			t4 = text(" pojas");
    			t5 = space();
    			br0 = element("br");
    			t6 = space();
    			div3 = element("div");
    			div1 = element("div");
    			div1.textContent = "Izračunaj:";
    			t8 = space();
    			br1 = element("br");
    			t9 = space();
    			div2 = element("div");
    			t10 = text(/*lijevi*/ ctx[1]);
    			t11 = text(" * ");
    			t12 = text(/*desni*/ ctx[2]);
    			t13 = space();
    			br2 = element("br");
    			t14 = space();
    			div4 = element("div");
    			div4.textContent = "Rezultat:";
    			t16 = space();
    			input = element("input");
    			t17 = space();
    			br3 = element("br");
    			t18 = space();
    			br4 = element("br");
    			t19 = space();
    			button = element("button");
    			button.textContent = "Izračunaj";
    			t21 = space();
    			br5 = element("br");
    			t22 = space();
    			div5 = element("div");
    			t23 = text("Treba Vam jos\n    ");
    			t24 = text(/*jos*/ ctx[9]);
    			t25 = text("\n    pogodaka zaredom za\n    ");
    			t26 = text(t26_value);
    			t27 = text("\n    pojas");
    			t28 = space();
    			br6 = element("br");
    			t29 = space();
    			div6 = element("div");
    			t30 = text("ukupno pokusaja: ");
    			t31 = text(/*ukupnoPokusaja*/ ctx[3]);
    			t32 = space();
    			div7 = element("div");
    			t33 = text("ukupno tacnih: ");
    			t34 = text(/*ukupnoTacnih*/ ctx[4]);
    			t35 = space();
    			div8 = element("div");
    			t36 = text("ukupno netacnih: ");
    			t37 = text(/*ukupnoNetacnih*/ ctx[5]);
    			t38 = space();
    			div9 = element("div");
    			t39 = text("ukupno tacnih zaredom: ");
    			t40 = text(/*ukupnoTacnihZaredom*/ ctx[6]);
    			add_location(h1, file, 137, 2, 3269);
    			add_location(div0, file, 138, 2, 3297);
    			add_location(br0, file, 139, 2, 3344);
    			add_location(div1, file, 141, 4, 3363);
    			add_location(br1, file, 142, 4, 3389);
    			attr_dev(div2, "class", "brojevi svelte-i70wus");
    			add_location(div2, file, 143, 4, 3400);
    			add_location(div3, file, 140, 2, 3353);
    			add_location(br2, file, 145, 2, 3457);
    			add_location(div4, file, 146, 2, 3466);
    			attr_dev(input, "type", "number");
    			attr_dev(input, "class", "rezultat svelte-i70wus");
    			add_location(input, file, 147, 2, 3489);
    			add_location(br3, file, 153, 2, 3628);
    			add_location(br4, file, 154, 2, 3637);
    			attr_dev(button, "class", "dugme svelte-i70wus");
    			add_location(button, file, 155, 2, 3646);
    			add_location(br5, file, 156, 2, 3725);
    			add_location(div5, file, 157, 2, 3734);
    			add_location(br6, file, 164, 2, 3843);
    			add_location(div6, file, 165, 2, 3852);
    			add_location(div7, file, 166, 2, 3899);
    			add_location(div8, file, 167, 2, 3942);
    			add_location(div9, file, 168, 2, 3989);
    			attr_dev(main, "class", "svelte-i70wus");
    			add_location(main, file, 136, 0, 3260);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			append_dev(main, h1);
    			append_dev(main, t1);
    			append_dev(main, div0);
    			append_dev(div0, t2);
    			append_dev(div0, t3);
    			append_dev(div0, t4);
    			append_dev(main, t5);
    			append_dev(main, br0);
    			append_dev(main, t6);
    			append_dev(main, div3);
    			append_dev(div3, div1);
    			append_dev(div3, t8);
    			append_dev(div3, br1);
    			append_dev(div3, t9);
    			append_dev(div3, div2);
    			append_dev(div2, t10);
    			append_dev(div2, t11);
    			append_dev(div2, t12);
    			append_dev(main, t13);
    			append_dev(main, br2);
    			append_dev(main, t14);
    			append_dev(main, div4);
    			append_dev(main, t16);
    			append_dev(main, input);
    			set_input_value(input, /*rezultat*/ ctx[0]);
    			/*input_binding*/ ctx[14](input);
    			append_dev(main, t17);
    			append_dev(main, br3);
    			append_dev(main, t18);
    			append_dev(main, br4);
    			append_dev(main, t19);
    			append_dev(main, button);
    			append_dev(main, t21);
    			append_dev(main, br5);
    			append_dev(main, t22);
    			append_dev(main, div5);
    			append_dev(div5, t23);
    			append_dev(div5, t24);
    			append_dev(div5, t25);
    			append_dev(div5, t26);
    			append_dev(div5, t27);
    			append_dev(main, t28);
    			append_dev(main, br6);
    			append_dev(main, t29);
    			append_dev(main, div6);
    			append_dev(div6, t30);
    			append_dev(div6, t31);
    			append_dev(main, t32);
    			append_dev(main, div7);
    			append_dev(div7, t33);
    			append_dev(div7, t34);
    			append_dev(main, t35);
    			append_dev(main, div8);
    			append_dev(div8, t36);
    			append_dev(div8, t37);
    			append_dev(main, t38);
    			append_dev(main, div9);
    			append_dev(div9, t39);
    			append_dev(div9, t40);

    			if (!mounted) {
    				dispose = [
    					listen_dev(input, "input", /*input_input_handler*/ ctx[13]),
    					listen_dev(input, "keyup", prevent_default(/*handleKeyup*/ ctx[11]), false, true, false),
    					listen_dev(button, "click", prevent_default(/*calculate*/ ctx[12]), false, true, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*pojas*/ 256 && t3_value !== (t3_value = /*pojasevi*/ ctx[10][/*pojas*/ ctx[8]].ime + "")) set_data_dev(t3, t3_value);
    			if (dirty & /*lijevi*/ 2) set_data_dev(t10, /*lijevi*/ ctx[1]);
    			if (dirty & /*desni*/ 4) set_data_dev(t12, /*desni*/ ctx[2]);

    			if (dirty & /*rezultat*/ 1 && to_number(input.value) !== /*rezultat*/ ctx[0]) {
    				set_input_value(input, /*rezultat*/ ctx[0]);
    			}

    			if (dirty & /*jos*/ 512) set_data_dev(t24, /*jos*/ ctx[9]);
    			if (dirty & /*pojas*/ 256 && t26_value !== (t26_value = /*pojasevi*/ ctx[10][/*pojas*/ ctx[8] + 1].ime + "")) set_data_dev(t26, t26_value);
    			if (dirty & /*ukupnoPokusaja*/ 8) set_data_dev(t31, /*ukupnoPokusaja*/ ctx[3]);
    			if (dirty & /*ukupnoTacnih*/ 16) set_data_dev(t34, /*ukupnoTacnih*/ ctx[4]);
    			if (dirty & /*ukupnoNetacnih*/ 32) set_data_dev(t37, /*ukupnoNetacnih*/ ctx[5]);
    			if (dirty & /*ukupnoTacnihZaredom*/ 64) set_data_dev(t40, /*ukupnoTacnihZaredom*/ ctx[6]);
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			/*input_binding*/ ctx[14](null);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("App", slots, []);
    	var rezultat;
    	var lijevi;
    	var desni;
    	var ukupnoPokusaja = 0;
    	var ukupnoTacnih = 0;
    	var ukupnoNetacnih = 0;
    	var ukupnoTacnihZaredom = 0;
    	let elm;
    	let pojas = 0;
    	var jos = 1;

    	let pojasevi = [
    		{ ime: "bijeli", bodova: 1 },
    		{ ime: "zuti", bodova: 20 },
    		{ ime: "zeleni", bodova: 40 },
    		{ ime: "plavi", bodova: 70 },
    		{ ime: "crveni", bodova: 80 },
    		{ ime: "crni", bodova: 100 }
    	];

    	const checkPojas = () => {
    		console.log("pojas: ", pojasevi[pojas].ime);
    		console.log("tacnih zaredom: ", ukupnoTacnihZaredom);
    		console.log("bodova za pojas: ", pojasevi[pojas].bodova);

    		if (ukupnoTacnihZaredom === pojasevi[pojas].bodova) {
    			$$invalidate(8, pojas += 1);
    			localStorage.setItem("pojas", pojas);
    			$$invalidate(6, ukupnoTacnihZaredom = 0);
    			alert("Svaka cast, dobili ste " + pojasevi[pojas].ime + " pojas.");
    		}

    		$$invalidate(9, jos = pojasevi[pojas].bodova - ukupnoTacnihZaredom);
    	};

    	const postaviZadatak = () => {
    		let cinioci = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    		$$invalidate(1, lijevi = cinioci[Math.floor(Math.random() * cinioci.length)]);
    		$$invalidate(2, desni = cinioci[Math.floor(Math.random() * cinioci.length)]);
    	};

    	onMount(() => {
    		postaviZadatak();
    		$$invalidate(3, ukupnoPokusaja = parseInt(localStorage.getItem("ukupnoPokusaja")) || 0);
    		$$invalidate(4, ukupnoTacnih = parseInt(localStorage.getItem("ukupnoTacnih")) || 0);
    		$$invalidate(5, ukupnoNetacnih = parseInt(localStorage.getItem("ukupnoNetacnih")) || 0);
    		$$invalidate(8, pojas = parseInt(localStorage.getItem("pojas")) || 0);
    		$$invalidate(9, jos = pojasevi[pojas].bodova);
    		elm.focus();
    	});

    	const handleKeyup = () => {
    		if (event.code == "Enter") {
    			event.preventDefault();

    			// event.target.value
    			// value = event.target.value
    			console.log("enter:", event.target.value);

    			return false;
    		}
    	};

    	const calculate = e => {
    		const rez = e.target.value;

    		if (lijevi * desni === rezultat) {
    			console.log("tacno");
    			$$invalidate(3, ukupnoPokusaja += 1);
    			localStorage.setItem("ukupnoPokusaja", ukupnoPokusaja.toString());
    			$$invalidate(4, ukupnoTacnih += 1);
    			localStorage.setItem("ukupnoTacnih", ukupnoTacnih.toString());
    			$$invalidate(6, ukupnoTacnihZaredom += 1);
    		} else {
    			console.log("netacno");
    			$$invalidate(3, ukupnoPokusaja += 1);
    			localStorage.setItem("ukupnoPokusaja", ukupnoPokusaja.toString());
    			$$invalidate(5, ukupnoNetacnih += 1);
    			localStorage.setItem("ukupnoNetacnih", ukupnoNetacnih.toString());
    			$$invalidate(6, ukupnoTacnihZaredom = 0);
    		}

    		checkPojas();
    		postaviZadatak();
    		$$invalidate(0, rezultat = "");
    		elm.focus();
    	};

    	const tacanRezultat = () => {
    		
    	};

    	const netacanRezultat = () => {
    		
    	};

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console_1.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	function input_input_handler() {
    		rezultat = to_number(this.value);
    		$$invalidate(0, rezultat);
    	}

    	function input_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			elm = $$value;
    			$$invalidate(7, elm);
    		});
    	}

    	$$self.$capture_state = () => ({
    		onMount,
    		rezultat,
    		lijevi,
    		desni,
    		ukupnoPokusaja,
    		ukupnoTacnih,
    		ukupnoNetacnih,
    		ukupnoTacnihZaredom,
    		elm,
    		pojas,
    		jos,
    		pojasevi,
    		checkPojas,
    		postaviZadatak,
    		handleKeyup,
    		calculate,
    		tacanRezultat,
    		netacanRezultat
    	});

    	$$self.$inject_state = $$props => {
    		if ("rezultat" in $$props) $$invalidate(0, rezultat = $$props.rezultat);
    		if ("lijevi" in $$props) $$invalidate(1, lijevi = $$props.lijevi);
    		if ("desni" in $$props) $$invalidate(2, desni = $$props.desni);
    		if ("ukupnoPokusaja" in $$props) $$invalidate(3, ukupnoPokusaja = $$props.ukupnoPokusaja);
    		if ("ukupnoTacnih" in $$props) $$invalidate(4, ukupnoTacnih = $$props.ukupnoTacnih);
    		if ("ukupnoNetacnih" in $$props) $$invalidate(5, ukupnoNetacnih = $$props.ukupnoNetacnih);
    		if ("ukupnoTacnihZaredom" in $$props) $$invalidate(6, ukupnoTacnihZaredom = $$props.ukupnoTacnihZaredom);
    		if ("elm" in $$props) $$invalidate(7, elm = $$props.elm);
    		if ("pojas" in $$props) $$invalidate(8, pojas = $$props.pojas);
    		if ("jos" in $$props) $$invalidate(9, jos = $$props.jos);
    		if ("pojasevi" in $$props) $$invalidate(10, pojasevi = $$props.pojasevi);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [
    		rezultat,
    		lijevi,
    		desni,
    		ukupnoPokusaja,
    		ukupnoTacnih,
    		ukupnoNetacnih,
    		ukupnoTacnihZaredom,
    		elm,
    		pojas,
    		jos,
    		pojasevi,
    		handleKeyup,
    		calculate,
    		input_input_handler,
    		input_binding
    	];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    const app = new App({
      target: document.body
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
