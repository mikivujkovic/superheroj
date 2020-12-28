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
    	let img;
    	let img_src_value;
    	let t6;
    	let br0;
    	let t7;
    	let div5;
    	let div3;
    	let div1;
    	let t9;
    	let br1;
    	let t10;
    	let div2;
    	let t11;
    	let t12;
    	let t13;
    	let t14;
    	let br2;
    	let t15;
    	let div4;
    	let t17;
    	let input;
    	let t18;
    	let br3;
    	let t19;
    	let br4;
    	let t20;
    	let button;
    	let t22;
    	let br5;
    	let t23;
    	let div6;
    	let t24;
    	let t25;
    	let t26;
    	let t27_value = /*pojasevi*/ ctx[10][/*pojas*/ ctx[8] + 1].ime + "";
    	let t27;
    	let t28;
    	let t29;
    	let br6;
    	let t30;
    	let div7;
    	let t31;
    	let t32;
    	let t33;
    	let div8;
    	let t34;
    	let t35;
    	let t36;
    	let div9;
    	let t37;
    	let t38;
    	let t39;
    	let div10;
    	let t40;
    	let t41;
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
    			img = element("img");
    			t6 = space();
    			br0 = element("br");
    			t7 = space();
    			div5 = element("div");
    			div3 = element("div");
    			div1 = element("div");
    			div1.textContent = "Izračunaj:";
    			t9 = space();
    			br1 = element("br");
    			t10 = space();
    			div2 = element("div");
    			t11 = text(/*lijevi*/ ctx[1]);
    			t12 = text(" * ");
    			t13 = text(/*desni*/ ctx[2]);
    			t14 = space();
    			br2 = element("br");
    			t15 = space();
    			div4 = element("div");
    			div4.textContent = "Rezultat:";
    			t17 = space();
    			input = element("input");
    			t18 = space();
    			br3 = element("br");
    			t19 = space();
    			br4 = element("br");
    			t20 = space();
    			button = element("button");
    			button.textContent = "Izračunaj";
    			t22 = space();
    			br5 = element("br");
    			t23 = space();
    			div6 = element("div");
    			t24 = text("Treba Vam jos\n    ");
    			t25 = text(/*jos*/ ctx[9]);
    			t26 = text("\n    pogodaka zaredom za\n    ");
    			t27 = text(t27_value);
    			t28 = text("\n    pojas");
    			t29 = space();
    			br6 = element("br");
    			t30 = space();
    			div7 = element("div");
    			t31 = text("ukupno pokusaja: ");
    			t32 = text(/*ukupnoPokusaja*/ ctx[3]);
    			t33 = space();
    			div8 = element("div");
    			t34 = text("ukupno tacnih: ");
    			t35 = text(/*ukupnoTacnih*/ ctx[4]);
    			t36 = space();
    			div9 = element("div");
    			t37 = text("ukupno netacnih: ");
    			t38 = text(/*ukupnoNetacnih*/ ctx[5]);
    			t39 = space();
    			div10 = element("div");
    			t40 = text("ukupno tacnih zaredom: ");
    			t41 = text(/*ukupnoTacnihZaredom*/ ctx[6]);
    			attr_dev(h1, "class", "svelte-48w7zt");
    			add_location(h1, file, 172, 2, 3922);
    			add_location(div0, file, 173, 2, 3950);
    			if (img.src !== (img_src_value = /*slikePojaseva*/ ctx[11][/*pojas*/ ctx[8]])) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "pojas");
    			attr_dev(img, "class", "pojas svelte-48w7zt");
    			add_location(img, file, 174, 2, 3997);
    			add_location(br0, file, 175, 2, 4060);
    			attr_dev(div1, "class", "tekst svelte-48w7zt");
    			add_location(div1, file, 178, 6, 4105);
    			add_location(br1, file, 179, 6, 4147);
    			attr_dev(div2, "class", "brojevi svelte-48w7zt");
    			add_location(div2, file, 180, 6, 4160);
    			add_location(div3, file, 177, 4, 4093);
    			add_location(br2, file, 182, 4, 4221);
    			attr_dev(div4, "class", "tekst svelte-48w7zt");
    			add_location(div4, file, 183, 4, 4232);
    			attr_dev(input, "type", "number");
    			attr_dev(input, "class", "rezultat svelte-48w7zt");
    			add_location(input, file, 184, 4, 4271);
    			add_location(br3, file, 190, 4, 4422);
    			add_location(br4, file, 191, 4, 4433);
    			attr_dev(button, "class", "dugme svelte-48w7zt");
    			add_location(button, file, 192, 4, 4444);
    			attr_dev(div5, "class", "racun svelte-48w7zt");
    			add_location(div5, file, 176, 2, 4069);
    			add_location(br5, file, 194, 2, 4532);
    			add_location(div6, file, 195, 2, 4541);
    			add_location(br6, file, 202, 2, 4650);
    			add_location(div7, file, 203, 2, 4659);
    			add_location(div8, file, 204, 2, 4706);
    			add_location(div9, file, 205, 2, 4749);
    			add_location(div10, file, 206, 2, 4796);
    			attr_dev(main, "class", "svelte-48w7zt");
    			add_location(main, file, 171, 0, 3913);
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
    			append_dev(main, img);
    			append_dev(main, t6);
    			append_dev(main, br0);
    			append_dev(main, t7);
    			append_dev(main, div5);
    			append_dev(div5, div3);
    			append_dev(div3, div1);
    			append_dev(div3, t9);
    			append_dev(div3, br1);
    			append_dev(div3, t10);
    			append_dev(div3, div2);
    			append_dev(div2, t11);
    			append_dev(div2, t12);
    			append_dev(div2, t13);
    			append_dev(div5, t14);
    			append_dev(div5, br2);
    			append_dev(div5, t15);
    			append_dev(div5, div4);
    			append_dev(div5, t17);
    			append_dev(div5, input);
    			set_input_value(input, /*rezultat*/ ctx[0]);
    			/*input_binding*/ ctx[15](input);
    			append_dev(div5, t18);
    			append_dev(div5, br3);
    			append_dev(div5, t19);
    			append_dev(div5, br4);
    			append_dev(div5, t20);
    			append_dev(div5, button);
    			append_dev(main, t22);
    			append_dev(main, br5);
    			append_dev(main, t23);
    			append_dev(main, div6);
    			append_dev(div6, t24);
    			append_dev(div6, t25);
    			append_dev(div6, t26);
    			append_dev(div6, t27);
    			append_dev(div6, t28);
    			append_dev(main, t29);
    			append_dev(main, br6);
    			append_dev(main, t30);
    			append_dev(main, div7);
    			append_dev(div7, t31);
    			append_dev(div7, t32);
    			append_dev(main, t33);
    			append_dev(main, div8);
    			append_dev(div8, t34);
    			append_dev(div8, t35);
    			append_dev(main, t36);
    			append_dev(main, div9);
    			append_dev(div9, t37);
    			append_dev(div9, t38);
    			append_dev(main, t39);
    			append_dev(main, div10);
    			append_dev(div10, t40);
    			append_dev(div10, t41);

    			if (!mounted) {
    				dispose = [
    					listen_dev(input, "input", /*input_input_handler*/ ctx[14]),
    					listen_dev(input, "keyup", prevent_default(/*handleKeyup*/ ctx[12]), false, true, false),
    					listen_dev(button, "click", prevent_default(/*calculate*/ ctx[13]), false, true, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*pojas*/ 256 && t3_value !== (t3_value = /*pojasevi*/ ctx[10][/*pojas*/ ctx[8]].ime + "")) set_data_dev(t3, t3_value);

    			if (dirty & /*pojas*/ 256 && img.src !== (img_src_value = /*slikePojaseva*/ ctx[11][/*pojas*/ ctx[8]])) {
    				attr_dev(img, "src", img_src_value);
    			}

    			if (dirty & /*lijevi*/ 2) set_data_dev(t11, /*lijevi*/ ctx[1]);
    			if (dirty & /*desni*/ 4) set_data_dev(t13, /*desni*/ ctx[2]);

    			if (dirty & /*rezultat*/ 1 && to_number(input.value) !== /*rezultat*/ ctx[0]) {
    				set_input_value(input, /*rezultat*/ ctx[0]);
    			}

    			if (dirty & /*jos*/ 512) set_data_dev(t25, /*jos*/ ctx[9]);
    			if (dirty & /*pojas*/ 256 && t27_value !== (t27_value = /*pojasevi*/ ctx[10][/*pojas*/ ctx[8] + 1].ime + "")) set_data_dev(t27, t27_value);
    			if (dirty & /*ukupnoPokusaja*/ 8) set_data_dev(t32, /*ukupnoPokusaja*/ ctx[3]);
    			if (dirty & /*ukupnoTacnih*/ 16) set_data_dev(t35, /*ukupnoTacnih*/ ctx[4]);
    			if (dirty & /*ukupnoNetacnih*/ 32) set_data_dev(t38, /*ukupnoNetacnih*/ ctx[5]);
    			if (dirty & /*ukupnoTacnihZaredom*/ 64) set_data_dev(t41, /*ukupnoTacnihZaredom*/ ctx[6]);
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			/*input_binding*/ ctx[15](null);
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

    	let slikePojaseva = [
    		"/pojasevi/bijeli.png",
    		"/pojasevi/zuti.png",
    		"/pojasevi/zeleni.png",
    		"/pojasevi/plavi.png",
    		"/pojasevi/crveni.png",
    		"/pojasevi/crni.png"
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
    		slikePojaseva,
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
    		if ("slikePojaseva" in $$props) $$invalidate(11, slikePojaseva = $$props.slikePojaseva);
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
    		slikePojaseva,
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
